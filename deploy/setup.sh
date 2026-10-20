#!/usr/bin/env bash
# One-time (and re-runnable) server setup for Agency Vault on Ubuntu 22.04 / 24.04.
#   Usage (as root, with the app already copied to /opt/agency-vault):
#     bash /opt/agency-vault/deploy/setup.sh vault.yourdomain.com   # HTTPS on your domain (recommended)
#     bash /opt/agency-vault/deploy/setup.sh                        # plain HTTP on the server IP (testing only)
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/agency-vault

[ "$(id -u)" = 0 ] || { echo "Please run as root (or with sudo)."; exit 1; }
[ -f "$APP_DIR/package.json" ] || { echo "App not found in $APP_DIR. Copy it there first."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update -y
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx build-essential python3
[ -n "$DOMAIN" ] && apt-get install -y certbot python3-certbot-nginx
command -v pm2 >/dev/null || npm install -g pm2

# Small droplets (512 MB / 1 GB) can run out of memory while installing packages.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
  echo "==> Adding 1 GB swap"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Installing app dependencies"
cd "$APP_DIR"
npm ci --omit=dev
mkdir -p data && chmod 700 data

echo "==> Starting the app with PM2"
SECURE=false; [ -n "$DOMAIN" ] && SECURE=true
pm2 delete agency-vault >/dev/null 2>&1 || true
COOKIE_SECURE=$SECURE TRUST_PROXY=true PORT=3000 pm2 start src/server.js --name agency-vault --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null

echo "==> Configuring Nginx"
cat > /etc/nginx/sites-available/agency-vault <<EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};
    client_max_body_size 2m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/agency-vault /etc/nginx/sites-enabled/agency-vault
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall: allowing SSH and web traffic only"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

if [ -n "$DOMAIN" ]; then
  echo "==> Getting a free SSL certificate for $DOMAIN (certbot will ask for your email and agreement)"
  certbot --nginx -d "$DOMAIN" --redirect
  echo; echo "Done! Open https://$DOMAIN"
else
  IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
  echo; echo "Done! Open http://$IP"
  echo "WARNING: without a domain + HTTPS, logins and passwords travel unencrypted. Use this for testing only."
fi

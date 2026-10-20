#!/usr/bin/env bash
# Install or update Agency Vault on Ubuntu 22.04 / 24.04. Safe to run again: it pulls the latest code and restarts.
#   As root on the server:
#     curl -fsSL https://raw.githubusercontent.com/wavekartdigital/application/main/deploy/setup.sh | bash -s -- vault.yourdomain.com
#   Without a domain (plain HTTP on the server IP, testing only):
#     curl -fsSL https://raw.githubusercontent.com/wavekartdigital/application/main/deploy/setup.sh | bash
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/agency-vault
REPO=https://github.com/wavekartdigital/application.git

[ "$(id -u)" = 0 ] || { echo "Please run as root (or with sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update -y
apt-get install -y git curl

echo "==> Getting the latest app code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
elif [ -f "$APP_DIR/package.json" ]; then
  echo "Using the app already copied to $APP_DIR"
else
  mkdir -p "$APP_DIR"
  git clone "$REPO" "$APP_DIR.tmp"
  cp -a "$APP_DIR.tmp/." "$APP_DIR/" && rm -rf "$APP_DIR.tmp"   # keeps a data/ folder you may have uploaded first
fi
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

if [ -f /etc/iptables/rules.v4 ] && grep -q REJECT /etc/iptables/rules.v4; then
  # Oracle Cloud Ubuntu images ship iptables rules that reject everything except SSH: open 80/443 there.
  echo "==> Firewall (Oracle Cloud image): opening ports 80 and 443"
  for p in 80 443; do
    iptables -C INPUT -m state --state NEW -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
  done
  netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
else
  echo "==> Firewall: allowing SSH and web traffic only"
  apt-get install -y ufw >/dev/null
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable >/dev/null
fi

if [ -n "$DOMAIN" ]; then
  echo "==> Getting a free SSL certificate for $DOMAIN (certbot will ask for your email and agreement)"
  certbot --nginx -d "$DOMAIN" --redirect
  echo; echo "Done! Open https://$DOMAIN"
else
  IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
  echo; echo "Done! Open http://$IP"
  echo "WARNING: without a domain + HTTPS, logins and passwords travel unencrypted. Use this for testing only."
fi

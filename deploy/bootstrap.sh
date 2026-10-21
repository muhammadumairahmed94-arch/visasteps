#!/bin/bash
# One-time setup of a fresh Ubuntu 24.04 server (DigitalOcean droplet). Run as root:
#   ssh root@SERVER 'bash -s' < deploy/bootstrap.sh
set -euo pipefail

echo "== Updates and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get upgrade -yq
apt-get install -yq unattended-upgrades fail2ban ufw ca-certificates curl rsync
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Firewall: SSH and web only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "== SSH: keys only"
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd

echo "== 4 GB swap (headroom for the virus scanner on a 2 GB server)"
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

sysctl -w vm.swappiness=10 >/dev/null && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf

echo "== Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

mkdir -p /opt/visasteps
echo "== Done. Next: copy the portal (scripts/deploy.sh) and create /opt/visasteps/.env"

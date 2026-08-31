#!/usr/bin/env bash
# Linked Helper VPS - one-command setup for a fresh Ubuntu server.
#
# Turns a bare Ubuntu VPS (22.04/24.04, x64) into a self-healing Linked Helper machine:
#   - GNOME desktop on the console X session, with auto-login (survives reboots unattended)
#     GNOME because LH's requirements page says "Gnome GUI is mandatory" on Linux
#     (KDE/LXDE/XFCE "not officially supported"). Wayland is disabled - x11vnc and
#     xdotool need plain X11.
#   - Headless X via the dummy video driver (a VPS has no monitor)
#   - x11vnc mirroring the ONE console screen + xRDP bridged to it, so every remote login
#     (client's built-in RDP app, Guy's Splashtop) sees the SAME screen LH is running on.
#     Never a fresh-session-per-login - that shows an empty desktop and causes
#     "where's my Linked Helper?" panic.
#   - Linked Helper installed from their official .deb
#   - LH autostarts on login with --start-account-id=<id>
#   - Watchdog every 5 min (lh-watchdog.py): if LH is down, start it; if the campaigns
#     runner is off, press "Start campaigns runner" via LH's own DevTools channel;
#     optionally report status to the server.
#   - Nightly reboot at 03:00 local time (the maintenance window)
#
# Status: WRITTEN 2026-08-29, NOT YET RUN ON A REAL VPS. Test on Guy's own machine first.
# See docs/linked-helper-machine-setup.md (Part 5 - Ubuntu VPS).
#
# Usage (as root on a fresh VPS):
#   LH_ACCOUNT_ID=16045 CLIENT_ID=Guy-Wilson TZ_NAME=Australia/Brisbane \
#   VNC_PASSWORD='choose-one' bash setup-ubuntu-vps.sh
#
# Optional: REPORT_URL + REPORT_SECRET for status reporting (watchdog posts JSON).
# Deliberately NOT here yet: the nightly backup export/upload (phase 2 - needs the
# Launcher-side backup button flow proven first).

set -euo pipefail

LH_ACCOUNT_ID="${LH_ACCOUNT_ID:?Set LH_ACCOUNT_ID (Linked Helper account id, e.g. 16045)}"
CLIENT_ID="${CLIENT_ID:?Set CLIENT_ID (e.g. Guy-Wilson - used in status reports)}"
TZ_NAME="${TZ_NAME:-Australia/Brisbane}"
VNC_PASSWORD="${VNC_PASSWORD:?Set VNC_PASSWORD (used for RDP/VNC access to the screen)}"
REPORT_URL="${REPORT_URL:-}"
REPORT_SECRET="${REPORT_SECRET:-}"
LH_USER="${LH_USER:-lh}"
LH_DEB_URL="https://do0ca1hx6twig.cloudfront.net/linked-helper/444657160c922f6b8048468fef840020/latest/linux/x64/linked-helper.deb"

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
. /etc/os-release; case "${VERSION_ID%%.*}" in 18|20|22|24) ;; *) echo "WARNING: untested on Ubuntu $VERSION_ID";; esac

echo "== timezone =="
timedatectl set-timezone "$TZ_NAME"

echo "== dedicated user =="
id "$LH_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "Linked Helper" "$LH_USER"
LH_HOME="$(getent passwd "$LH_USER" | cut -d: -f6)"

echo "== packages (desktop, xrdp, tools) =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq xfce4 xfce4-terminal lightdm xserver-xorg-video-dummy \
  x11vnc xrdp xdotool wmctrl curl wget jq python3 python3-websockets \
  fail2ban ufw fonts-liberation libasound2t64 2>/dev/null || \
apt-get install -y -qq xfce4 xfce4-terminal lightdm xserver-xorg-video-dummy \
  x11vnc xrdp xdotool wmctrl curl wget jq python3 python3-websockets \
  fail2ban ufw fonts-liberation libasound2

echo "== headless X: dummy monitor 1920x1080 =="
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-dummy.conf <<'EOF'
Section "Device"
    Identifier "DummyDevice"
    Driver "dummy"
    VideoRam 256000
EndSection
Section "Monitor"
    Identifier "DummyMonitor"
    HorizSync 28.0-80.0
    VertRefresh 48.0-75.0
    Modeline "1920x1080" 172.80 1920 2040 2248 2576 1080 1081 1084 1118
EndSection
Section "Screen"
    Identifier "DummyScreen"
    Device "DummyDevice"
    Monitor "DummyMonitor"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1920x1080"
    EndSubSection
EndSection
EOF

echo "== auto-login to the console desktop (GDM, Wayland off - x11vnc needs X11) =="
python3 - "$LH_USER" <<'PYEOF'
import re, sys
user = sys.argv[1]
p = '/etc/gdm3/custom.conf'
s = open(p).read()
def setkey(s, key, val):
    if re.search(rf'^\s*#?\s*{key}\s*=', s, re.M):
        return re.sub(rf'^\s*#?\s*{key}\s*=.*$', f'{key}={val}', s, count=1, flags=re.M)
    return s.replace('[daemon]', f'[daemon]
{key}={val}', 1)
s = setkey(s, 'WaylandEnable', 'false')
s = setkey(s, 'AutomaticLoginEnable', 'true')
s = setkey(s, 'AutomaticLogin', user)
open(p, 'w').write(s)
print('gdm3 custom.conf updated')
PYEOF
# GNOME idle/lock would blank the unattended session - disable for the LH user
sudo -u "$LH_USER" dbus-launch gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
sudo -u "$LH_USER" dbus-launch gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true

echo "== x11vnc mirroring the console display =="
install -o "$LH_USER" -g "$LH_USER" -m 700 -d "$LH_HOME/.vnc"
x11vnc -storepasswd "$VNC_PASSWORD" "$LH_HOME/.vnc/passwd" >/dev/null
chown "$LH_USER:$LH_USER" "$LH_HOME/.vnc/passwd"
cat > /etc/systemd/system/x11vnc.service <<EOF
[Unit]
Description=x11vnc on the console display
After=gdm.service
Requires=gdm.service
[Service]
User=$LH_USER
Environment=DISPLAY=:0
ExecStartPre=/bin/sh -c 'for i in \$(seq 1 60); do [ -S /tmp/.X11-unix/X0 ] && exit 0; sleep 2; done; exit 1'
ExecStart=/usr/bin/x11vnc -display :0 -auth /run/user/$(id -u $LH_USER)/gdm/Xauthority -auth guess -rfbauth $LH_HOME/.vnc/passwd -localhost -forever -shared -noxdamage
Restart=always
RestartSec=5
[Install]
WantedBy=graphical.target
EOF

echo "== xRDP -> the same console screen (not a new session) =="
# Route RDP logins to the x11vnc mirror so RDP shows the ONE real screen.
python3 - <<'PY'
import re
p='/etc/xrdp/xrdp.ini'
s=open(p).read()
if 'name=LinkedHelperConsole' not in s:
    block='\n[LinkedHelperConsole]\nname=LinkedHelperConsole\nlib=libvnc.so\nusername=na\npassword=ask\nip=127.0.0.1\nport=5900\n'
    s=re.sub(r'\n\[Xorg\]', block+'\n[Xorg]', s, count=1)
    # make the console mirror the first (default) option
    open(p,'w').write(s)
print('xrdp.ini updated')
PY
systemctl enable xrdp

echo "== firewall: SSH + RDP only, VNC stays localhost =="
ufw allow OpenSSH >/dev/null
ufw allow 3389/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable fail2ban

echo "== Linked Helper =="
wget -q -O /tmp/linked-helper.deb "$LH_DEB_URL"
apt-get install -y -qq /tmp/linked-helper.deb
LH_BIN="$(command -v linked-helper || echo /opt/linked-helper/linked-helper)"
[ -x "$LH_BIN" ] || LH_BIN="$(dpkg -L linked-helper 2>/dev/null | grep -E '/linked-helper$' | head -1)"
echo "LH binary: $LH_BIN"

echo "== machine config =="
cat > /etc/linked-helper-machine.conf <<EOF
LH_ACCOUNT_ID=$LH_ACCOUNT_ID
CLIENT_ID=$CLIENT_ID
LH_BIN=$LH_BIN
REPORT_URL=$REPORT_URL
REPORT_SECRET=$REPORT_SECRET
EOF
chmod 600 /etc/linked-helper-machine.conf

echo "== LH autostart on desktop login =="
install -o "$LH_USER" -g "$LH_USER" -d "$LH_HOME/.config/autostart"
cat > "$LH_HOME/.config/autostart/linked-helper.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Linked Helper
Exec=$LH_BIN --start-account-id=$LH_ACCOUNT_ID
X-GNOME-Autostart-enabled=true
EOF
chown "$LH_USER:$LH_USER" "$LH_HOME/.config/autostart/linked-helper.desktop"

echo "== watchdog =="
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SRC_DIR/lh-watchdog.py" /usr/local/bin/lh-watchdog.py
cat > /etc/systemd/system/lh-watchdog.service <<EOF
[Unit]
Description=Linked Helper watchdog (start LH / press Start campaigns runner / report)
[Service]
Type=oneshot
User=$LH_USER
Environment=DISPLAY=:0
ExecStart=/usr/bin/python3 /usr/local/bin/lh-watchdog.py
EOF
cat > /etc/systemd/system/lh-watchdog.timer <<'EOF'
[Unit]
Description=Run the Linked Helper watchdog every 5 minutes
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable x11vnc.service lh-watchdog.timer

echo "== nightly maintenance reboot 03:00 local =="
cat > /etc/cron.d/lh-nightly-reboot <<'EOF'
0 3 * * * root /sbin/shutdown -r +1 "Linked Helper nightly maintenance reboot"
EOF

echo
echo "DONE. Reboot now (reboot) - the machine should come back with the desktop"
echo "auto-logged-in and Linked Helper open. First-time manual steps after reboot:"
echo "  1. RDP to this machine (pick 'LinkedHelperConsole', password = your VNC password)"
echo "  2. Log Linked Helper into the client's LH account + LinkedIn (one-time verification)"
echo "  3. Tick 'Restart after updates' in the Launcher's Check-and-install-updates screen"
echo "  4. Watch one watchdog cycle: systemctl start lh-watchdog.service; journalctl -u lh-watchdog"

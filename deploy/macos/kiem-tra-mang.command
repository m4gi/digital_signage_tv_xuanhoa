#!/bin/bash
# Network test for one floor, macOS version of kiem-tra-mang.ps1: run on a Mac plugged into that floor's switch
# (no admin rights, nothing to install). Same checks, same report: PASS/FAIL with what to fix, a report in
# ket-qua/ next to this file and a line in ket-qua/tong-hop.csv (same columns as the Windows kit, so both can share it).
#   double-click kiem-tra-mang.command        asks floor name and server (Enter = defaults)
#   bash kiem-tra-mang.command --tang "Tầng 3" --server 10.188.44.67 --screen-port 8081 --admin-port 8082
# Plain bash 3.2 and the tools every Mac has (route, ifconfig, ipconfig, scutil, curl, ping, traceroute).

DEFAULT_SERVER=10.188.44.67
DEFAULT_SCREEN=8081
DEFAULT_ADMIN=8082
DIR=$(cd "$(dirname "$0")" && pwd)
export LC_ALL=en_US.UTF-8
set -f # traceroute prints '*' for silent hops: never expand it into file names
ERR=$(mktemp "${TMPDIR:-/tmp}/kiem-tra-mang.XXXXXX")
trap 'rm -f "$ERR"' EXIT

TANG= SERVER= SCREEN_PORT= ADMIN_PORT= ASKED=
while [ $# -gt 0 ]; do
  case "$1" in
    --tang) TANG=$2; shift 2 ;;
    --server) SERVER=$2; shift 2 ;;
    --screen-port) SCREEN_PORT=$2; shift 2 ;;
    --admin-port) ADMIN_PORT=$2; shift 2 ;;
    *) echo "Không hiểu tham số: $1"; exit 1 ;;
  esac
done

if [ -t 1 ]; then R=$'\e[31m' G=$'\e[32m' Y=$'\e[33m' C=$'\e[36m' W=$'\e[1;37m' N=$'\e[0m'; else R= G= Y= C= W= N=; fi
LINES_OUT=()
note() { LINES_OUT+=("$1"); }
say() { printf '%s%s%s\n' "$2" "$1" "$N"; }
# result KEY OK(1/0) LABEL DETAIL FIX
result() {
  eval "RES_$1=$2"
  if [ "$2" = 1 ]; then say "  [ĐẠT] $3: $4" "$G"; note "[ĐẠT] $3: $4"
  else say "  [LỖI] $3: $4" "$R"; note "[LỖI] $3: $4"
    if [ -n "$5" ]; then say "        → $5" "$Y"; note "      → $5"; fi
  fi
}
info() { say "  [i] $1: $2" "$C"; note "[i] $1: $2"; }
ask() {
  local a
  read -r -p "$1 [Enter = $2]: " a
  a=$(printf '%s' "$a" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -n "$a" ] && printf '%s' "$a" || printf '%s' "$2"
}

# TCP connect with a 3s timeout, done with curl so the time is measured too.
# Sets TCP_OK (1/0), TCP_MS, TCP_REFUSED (1/0), TCP_WHY.
tcp() {
  local out rc err
  out=$(curl -sS -o /dev/null --connect-timeout 3 --max-time 5 -w '%{time_connect}' "http://$1:$2/" 2>"$ERR")
  rc=$?
  err=$(sed 's/^curl: ([0-9]*) //' "$ERR" | head -1)
  TCP_OK=0 TCP_REFUSED=0 TCP_MS= TCP_WHY=
  case "$rc" in
    0|52|56) TCP_OK=1 ;; # 52/56: connected, then the server closed or answered oddly: the port is still open
    28) TCP_WHY="hết thời gian chờ (3000 ms): gói tin bị chặn hoặc không có đường đi" ;;
    # curl 8 says only "Couldn't connect"; macOS nc names the cause ("Connection refused", "No route to host").
    7) err="$err $(nc -z -G 3 "$1" "$2" 2>&1)"
       case "$err" in
         *refused*) TCP_REFUSED=1; TCP_WHY="máy đích từ chối: tới được máy nhưng cổng đang đóng" ;;
         *"No route"*) TCP_WHY="không có đường đi tới máy chủ (No route to host)" ;;
         *) TCP_WHY=${err%% nc:*} ;;
       esac ;;
    *) TCP_WHY=$err ;;
  esac
  [ "$TCP_OK" = 1 ] && TCP_MS=$(awk -v t="$out" 'BEGIN{printf "%d", t * 1000}')
}

# GET with a 5s timeout. Sets HTTP_CODE (0 = no answer), HTTP_BODY, HTTP_MS, HTTP_WHY.
http_get() {
  local out rc
  out=$(curl -sS --connect-timeout 3 --max-time 5 -w $'\n%{http_code} %{time_total}' "$1" 2>"$ERR")
  rc=$?
  if [ "$rc" = 0 ]; then
    HTTP_BODY=$(printf '%s' "$out" | sed '$d')
    set -- $(printf '%s' "$out" | tail -1)
    HTTP_CODE=$1 HTTP_MS=$(awk -v t="$2" 'BEGIN{printf "%d", t * 1000}') HTTP_WHY=
  else
    HTTP_CODE=0 HTTP_BODY= HTTP_MS= HTTP_WHY=$(sed 's/^curl: ([0-9]*) //' "$ERR" | head -1)
  fi
}

prefix_to_mask() { local p=$1 m= i b; for i in 1 2 3 4; do if [ "$p" -ge 8 ]; then b=255; p=$((p - 8)); else b=$(( (256 - (1 << (8 - p))) & 255 )); p=0; fi; m=$m${m:+.}$b; done; printf '%s' "$m"; }
# ifconfig prints the mask as 0xffffff00.
mask_to_prefix() { local v=$(( $1 )) n=0; while [ "$v" -gt 0 ]; do n=$((n + (v & 1))); v=$((v >> 1)); done; printf '%s' "$n"; }
port_name() { networksetup -listallhardwareports 2>/dev/null | awk -v d="$1" '/^Hardware Port:/{sub(/^Hardware Port: /,""); p=$0} $0=="Device: "d{print p; exit}'; }

# ---------- 0. what to test ----------
echo
say '=== KIỂM TRA MẠNG CHO MÀN HÌNH LỊCH HỌP ===' "$W"
HOST=$(scutil --get ComputerName 2>/dev/null || hostname -s)
[ -z "$TANG" ] || [ -z "$SERVER" ] || [ -z "$SCREEN_PORT" ] || [ -z "$ADMIN_PORT" ] && ASKED=1
[ -z "$TANG" ] && TANG=$(ask 'Tên tầng / vị trí đang kiểm tra' "$HOST")
[ -z "$SERVER" ] && SERVER=$(ask 'IP máy chủ lịch họp' "$DEFAULT_SERVER")
[ -z "$SCREEN_PORT" ] && SCREEN_PORT=$(ask 'Cổng màn hình' "$DEFAULT_SCREEN")
[ -z "$ADMIN_PORT" ] && ADMIN_PORT=$(ask 'Cổng quản trị' "$DEFAULT_ADMIN")
STAMP_SHOW=$(date '+%d/%m/%Y %H:%M:%S') STAMP_CSV=$(date '+%Y-%m-%d %H:%M') STAMP_FILE=$(date '+%Y%m%d-%H%M%S')
note "Kiểm tra mạng – $TANG – $STAMP_SHOW – máy $HOST"
note "Máy chủ $SERVER, cổng màn hình $SCREEN_PORT, cổng quản trị $ADMIN_PORT"
note ''

# ---------- 1. this Mac's address on the floor ----------
echo
say '1. Địa chỉ mạng của máy này' "$W"
GW=$(route -n get default 2>/dev/null | awk '/gateway:/{print $2}')
IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
ACTIVE=
for d in $(ifconfig -l); do
  case "$d" in lo*|utun*|awdl*|llw*|bridge*|gif*|stf*|anpi*|ap*) continue ;; esac
  a=$(ipconfig getifaddr "$d" 2>/dev/null)
  [ -z "$a" ] && continue
  n=$(port_name "$d")
  ACTIVE="$ACTIVE${ACTIVE:+, }${n:-$d}=$a"
  [ -z "$IF" ] && IF=$d # no default route: use the first connected card
done
IP= PREFIX=24
if [ -n "$IF" ] && IP=$(ipconfig getifaddr "$IF" 2>/dev/null) && [ -n "$IP" ]; then
  MASK=$(ifconfig "$IF" | awk '/inet /{print $4; exit}')
  [ -n "$MASK" ] && PREFIX=$(mask_to_prefix "$MASK")
  if [ -n "$(ipconfig getpacket "$IF" 2>/dev/null)" ]; then HOW='DHCP cấp'; else HOW='đặt tay'; fi
  NAME=$(port_name "$IF"); NAME=${NAME:-$IF}
  case "$IP" in 169.254.*) APIPA=1 ;; *) APIPA=0 ;; esac
  result ip $((1 - APIPA)) 'Có IP' "$IP ($NAME) /$PREFIX = mask $(prefix_to_mask "$PREFIX"), $HOW" \
    'IP 169.254.x.x = không nhận được DHCP: kiểm tra dây, cổng switch, VLAN của cổng và DHCP của tầng này (huong-dan-mang.md, mục 2)'
  if [ -n "$GW" ]; then result gw 1 'Có gateway' "$GW" ''
  else result gw 0 'Có gateway' 'không có' 'Không có gateway thì không ra khỏi tầng được: kiểm tra DHCP (option router) hoặc đặt tay (huong-dan-mang.md, mục 2)'; fi
  info 'DNS' "$(scutil --dns 2>/dev/null | awk '/nameserver\[[0-9]+\]/{print $3}' | grep -v ':' | awk '!s[$0]++' | paste -sd ',' - | sed 's/,/, /g')"
  case "$ACTIVE" in *,*)
    info 'Đang bật nhiều card mạng' "$ACTIVE"
    say '        → Nên tắt Wi-Fi khi kiểm tra để chắc chắn đang đi qua switch của tầng' "$Y" ;;
  esac
else
  IP=
  result ip 0 'Có IP' 'không có card mạng nào đang kết nối' 'Cắm dây mạng vào switch của tầng rồi chạy lại'
fi

# ---------- 2. gateway ----------
if [ -n "$GW" ]; then
  if ping -c 2 -t 3 "$GW" >/dev/null 2>&1; then info 'Ping gateway' "$GW trả lời"
  else info 'Ping gateway' "$GW không trả lời ping (thiết bị có thể chặn ping, chưa chắc là lỗi)"; fi
fi

# ---------- 3. screen port: what every standee needs ----------
echo
say "2. Cổng màn hình $SERVER:$SCREEN_PORT (bắt buộc cho standee)" "$W"
tcp "$SERVER" "$SCREEN_PORT"
if [ "$TCP_REFUSED" = 1 ]; then FIX="Mạng đã thông; trên máy chủ kiểm tra dịch vụ (Get-Service LedConference) và cổng màn hình trong data\\settings.json (huong-dan-mang.md, mục 3)"
else FIX="Mở đường từ dải mạng của tầng này ($IP/$PREFIX) tới $SERVER TCP $SCREEN_PORT trên thiết bị định tuyến giữa các tầng (huong-dan-mang.md, mục 4)"; fi
if [ "$TCP_OK" = 1 ]; then result tcpScreen 1 "Kết nối TCP $SCREEN_PORT" "thông ($TCP_MS ms)" ''
else result tcpScreen 0 "Kết nối TCP $SCREEN_PORT" "$TCP_WHY" "$FIX"; fi
if [ "$TCP_OK" = 1 ]; then
  http_get "http://$SERVER:$SCREEN_PORT/api/screens"
  if [ "$HTTP_CODE" = 200 ] && printf '%s' "$HTTP_BODY" | grep -Eq '"app"[[:space:]]*:[[:space:]]*"LedConference"'; then
    ROOMS=$(printf '%s' "$HTTP_BODY" | grep -Eo '"code"[[:space:]]*:' | wc -l | tr -d ' ')
    result api 1 'Máy chủ lịch họp trả lời' "$ROOMS phòng, $HTTP_MS ms" ''
  else
    if [ "$HTTP_CODE" != 0 ]; then D="HTTP $HTTP_CODE, không phải máy chủ lịch họp"; else D=$HTTP_WHY; fi
    result api 0 'Máy chủ lịch họp trả lời' "$D" "Cổng $SCREEN_PORT mở nhưng không phải LedConference: kiểm tra lại IP/cổng (trang quản trị > Phòng & màn hình > Địa chỉ cho app)"
  fi
  http_get "http://$SERVER:$SCREEN_PORT/lobby"
  if [ "$HTTP_CODE" != 0 ]; then D="HTTP $HTTP_CODE"; else D=$HTTP_WHY; fi
  result lobby $([ "$HTTP_CODE" = 200 ] && echo 1 || echo 0) 'Trang màn hình sảnh /lobby' "$D" 'Máy chủ bản cũ chưa có màn hình sảnh: cài lại bản mới'
fi

# ---------- 4. route ----------
echo
say '3. App có tự tìm thấy máy chủ không?' "$W"
if [ -n "$IP" ]; then
  NET24=${IP%.*}
  if [ "$NET24" = "${SERVER%.*}" ]; then RES_autoFind=1; info 'Tự tìm' "CÓ: máy chủ nằm trong dải $NET24.x của tầng này, app Android tự quét thấy"
  else RES_autoFind=0; info 'Tự tìm' "KHÔNG: máy chủ khác dải mạng, trên standee nhập tay $SERVER:$SCREEN_PORT ở ô 'Nhập địa chỉ máy chủ' (huong-dan-mang.md, mục 6)"; fi
fi

echo
say '4. Đường đi tới máy chủ (tối đa ~20 giây)' "$W"
HOPS=$(traceroute -n -m 10 -w 1 -q 1 "$SERVER" 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {print ($2 == "*" ? "*" : $2)}' | paste -sd ' ' -)
if [ -n "$HOPS" ]; then
  info 'Các bước' "$(printf '%s' "$HOPS" | sed 's/ / → /g')"
  FIRST=$(printf '%s\n' $HOPS | grep -v -x -e '*' -e "$SERVER" | head -1)
  set -- $HOPS
  if [ -n "$FIRST" ]; then info 'Thiết bị định tuyến đầu tiên' "$FIRST (nơi cần mở đường / ACL nếu cổng $SCREEN_PORT bị chặn)"
  elif [ "$1" = "$SERVER" ]; then info 'Thiết bị định tuyến' 'không có: máy chủ cùng mạng với máy này'
  elif [ -n "$GW" ]; then info 'Thiết bị định tuyến' "không trả lời traceroute (thường bị chặn); bắt đầu kiểm tra từ gateway của tầng: $GW"; fi
else info 'Các bước' 'không đo được (traceroute bị chặn)'; fi

# ---------- 5. admin port ----------
echo
say "5. Cổng quản trị $SERVER:$ADMIN_PORT (chỉ cần cho máy văn phòng)" "$W"
tcp "$SERVER" "$ADMIN_PORT"
if [ "$TCP_REFUSED" = 1 ]; then FIX="Mạng đã thông; kiểm tra cổng quản trị trong data\\settings.json trên máy chủ (huong-dan-mang.md, mục 3)"
else FIX="Nếu tầng này có máy cần vào trang quản trị: mở đường tới $SERVER TCP $ADMIN_PORT. Standee không cần cổng này. (huong-dan-mang.md, mục 4)"; fi
if [ "$TCP_OK" = 1 ]; then result tcpAdmin 1 "Kết nối TCP $ADMIN_PORT" "thông ($TCP_MS ms)" ''
else result tcpAdmin 0 "Kết nối TCP $ADMIN_PORT" "$TCP_WHY" "$FIX"; fi
if [ "$TCP_OK" = 1 ]; then
  http_get "http://$SERVER:$ADMIN_PORT/api/settings"
  if [ "$HTTP_CODE" = 200 ]; then result admin 1 'Được phép vào trang quản trị' "http://$SERVER:$ADMIN_PORT/" ''
  elif [ "$HTTP_CODE" = 403 ]; then result admin 0 'Được phép vào trang quản trị' "bị chặn: IP $IP không nằm trong adminAllow" "Thêm dải mạng này vào adminAllow trong data\\settings.json trên máy chủ rồi chạy Restart-Service LedConference (huong-dan-mang.md, mục 5)"
  else
    if [ "$HTTP_CODE" != 0 ]; then D="HTTP $HTTP_CODE"; else D=$HTTP_WHY; fi
    result admin 0 'Trang quản trị' "$D" 'Kiểm tra lại cổng quản trị'
  fi
fi

# ---------- 6. internet (information only) ----------
echo
say '6. Internet (chỉ để tham khảo, hệ thống KHÔNG cần Internet)' "$W"
if curl -s -o /dev/null --connect-timeout 3 --max-time 5 https://www.google.com; then RES_internet=1; info 'Internet' 'có'
else RES_internet=0; info 'Internet' 'không có (bình thường với mạng nội bộ)'; fi

# ---------- summary + report ----------
READY=0; [ "$RES_tcpScreen" = 1 ] && [ "$RES_api" = 1 ] && READY=1
echo
if [ "$READY" = 1 ]; then say "=== KẾT LUẬN: standee ở '$TANG' CHẠY ĐƯỢC (địa chỉ cho app: $SERVER:$SCREEN_PORT) ===" "$G"
else
  say "=== KẾT LUẬN: standee ở '$TANG' CHƯA CHẠY ĐƯỢC – xem các dòng LỖI ở trên ===" "$R"
  say "Hướng dẫn cấu hình từng lỗi: huong-dan-mang.md (cùng bộ cài với script này)" "$Y"
fi
note ''
if [ "$READY" = 1 ]; then note 'KẾT LUẬN: CHẠY ĐƯỢC'; else note 'KẾT LUẬN: CHƯA CHẠY ĐƯỢC'; fi

OUT="$DIR/ket-qua"
mkdir -p "$OUT"
SAFE=$(printf '%s' "$TANG" | tr -s '/\\:*?"<>| \t' '_')
FILE="$OUT/${SAFE}_$STAMP_FILE.txt"
printf '\xEF\xBB\xBF' > "$FILE"
printf '%s\r\n' "${LINES_OUT[@]}" >> "$FILE"

# Same columns, quoting, BOM and CRLF as Export-Csv on Windows, so both kits can fill one tong-hop.csv.
CSV="$OUT/tong-hop.csv"
v() { local x; eval "x=\${RES_$1-}"; case "$x" in 1) printf OK ;; 0) printf 'LỖI' ;; esac; }
csv_row() { local f s= q='"'; for f in "$@"; do s="$s${s:+,}$q${f//$q/$q$q}$q"; done; printf '%s\r\n' "$s"; }
if [ ! -s "$CSV" ]; then
  printf '\xEF\xBB\xBF' > "$CSV"
  csv_row 'Thời gian' 'Tầng' 'Máy' 'IP' 'Prefix' 'Gateway' 'Cổng màn hình' 'Máy chủ' 'Sảnh' 'Cổng quản trị' 'Quản trị' 'Tự tìm máy chủ' 'Internet' 'Đường đi' 'Kết luận' >> "$CSV"
fi
csv_row "$STAMP_CSV" "$TANG" "$HOST" "$IP" "$PREFIX" "$GW" "$(v tcpScreen)" "$(v api)" "$(v lobby)" "$(v tcpAdmin)" "$(v admin)" \
  "$(v autoFind)" "$(v internet)" "$HOPS" "$([ "$READY" = 1 ] && echo 'CHẠY ĐƯỢC' || echo 'CHƯA')" >> "$CSV"
echo
echo "Báo cáo: $FILE"
echo "Bảng tổng hợp các tầng: $CSV (mở bằng Excel hoặc Numbers)"

# Opened by double-click: keep the Terminal window open until it has been read.
if [ -n "$ASKED" ] && [ -t 0 ]; then echo; read -r -p 'Bấm Enter để đóng…' _; fi

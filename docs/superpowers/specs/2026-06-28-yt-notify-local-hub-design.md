# Thiết kế: YT-Notify Local Hub

- **Ngày:** 2026-06-28
- **Trạng thái:** Đã duyệt thiết kế, chờ viết kế hoạch triển khai
- **Phạm vi:** Ứng dụng local 1 máy (single-user), Windows

## 1. Mục tiêu & quyết định nền tảng

Xây ứng dụng desktop/web-local nhận thông báo video mới từ YouTube qua WebSub
(PubSubHubbub), phơi endpoint webhook ra Internet bằng Cloudflare Quick Tunnel, và
tự động tải video mới về máy. Giao diện dạng dashboard SPA.

Luồng: `YouTube WebSub Hub → Cloudflare Quick Tunnel → Public Webhook (local) →
Queue/DB → Downloader (yt-dlp) → UI realtime (Socket.io)`.

Các quyết định đã chốt:

| Quyết định | Lựa chọn | Hệ quả thiết kế |
| :--- | :--- | :--- |
| Tunnel | **Quick Tunnel** (`*.trycloudflare.com`), miễn phí, không cần domain | URL đổi mỗi lần (re)connect → **bắt buộc** có cơ chế tự re-subscribe toàn bộ kênh |
| Phạm vi | Cá nhân, 1 máy, local | Không cần multi-user auth; vẫn phải bảo vệ endpoint công khai |
| Tải video | Tải tất cả, chất lượng tốt nhất | `yt-dlp -f "bv*+ba/b"` + ffmpeg; vẫn cần queue + retry |

## 2. Vấn đề cốt lõi cần giải (rút ra từ nghiên cứu thực tế)

Đây là các rủi ro thực tế mà bản kế hoạch ban đầu chưa xử lý. Toàn bộ thiết kế xoay
quanh việc giải quyết chúng:

1. **URL tunnel ephemeral phá vỡ subscription.** Quick Tunnel đổi URL ngẫu nhiên mỗi
   lần (re)connect, kể cả khi tự rớt. YouTube WebSub lưu `hub.callback` lúc đăng ký,
   nên URL chết = ngừng nhận mọi thông báo. → Cần watcher giám sát URL liên tục và
   **re-subscribe tất cả kênh** mỗi khi URL đổi.
2. **Handshake xác minh.** Endpoint phải xử lý cả **GET** (echo `hub.challenge`) lẫn
   **POST** (nhận notification).
3. **Subscription hết hạn** sau `lease_seconds` (vài ngày) → cần scheduler tự gia hạn.
4. **Bảo mật endpoint công khai.** Verify chữ ký **HMAC-SHA1** (`X-Hub-Signature` +
   `hub.secret`); chống chèn thông báo giả → tải bừa.
5. **Thông báo trùng & xóa.** YouTube gửi lại khi sửa metadata, và gửi cả
   `at:deleted-entry`. → Khử trùng theo `videoId`; cập nhật metadata không kích hoạt tải.
6. **yt-dlp tải ngay dễ lỗi** (premiere/đang xử lý) → queue + retry/backoff + giới hạn
   song song.
7. **UX nhập kênh.** Người dùng có `@handle`/URL, không có `UCxxxx` thô → cần resolver.
8. **Mất kết nối = mất thông báo.** Khi tunnel chết, hub chỉ retry hạn chế → cần
   catch-up qua RSS khi reconnect.

## 3. Kiến trúc: tách 2 listener trong 1 tiến trình

`cloudflared --url localhost:PORT` phơi bày **toàn bộ** server ra Internet. Để phần
công khai chỉ làm đúng một việc, chạy 2 HTTP listener trong cùng tiến trình Node,
chia sẻ DB + queue + event bus:

| Listener | Cổng (mặc định) | Phục vụ | Phơi bày |
| :--- | :--- | :--- | :--- |
| **Public Webhook** | 8787 | CHỈ `GET/POST /webhook/youtube` | cloudflared tunnel trỏ vào đây |
| **Local Management** | 5174 | REST API quản lý + Socket.io + serve React build | bind `127.0.0.1`, KHÔNG tunnel |

Lý do: dù app local, webhook vẫn lộ Internet. Cách ly cổng + verify HMAC nghĩa là kẻ
biết URL public chỉ chạm được handler webhook đã ký, không đụng được API điều khiển
(thêm/xóa kênh, đổi settings, điều khiển tải).

*(Phương án thay thế đã cân nhắc: 1 cổng + middleware chặn path không phải `/webhook`.
Đơn giản hơn nhưng dễ sơ hở; chọn tách cổng.)*

## 4. Vòng đời WebSub & tự re-subscribe (trái tim hệ thống)

### 4.1 Khi tunnel (re)connect và bắt được URL mới
1. Spawn `cloudflared tunnel --url http://localhost:8787`.
2. Đọc **stderr** của cloudflared, regex bắt `https://<random>.trycloudflare.com`.
3. Health-check URL (GET tới chính nó qua public URL) rồi lưu `currentPublicUrl`.
4. Một **watcher chạy liên tục**: quick tunnel có thể tự rớt & đổi URL mà không cần
   bấm restart → phát hiện URL mới là kích hoạt bước re-subscribe.

### 4.2 Re-subscribe tất cả kênh active
Với mỗi kênh `active = true`, POST tới hub `https://pubsubhubbub.appspot.com/subscribe`:

```
hub.callback     = {currentPublicUrl}/webhook/youtube
hub.topic        = https://www.youtube.com/feeds/videos.xml?channel_id={UC...}
hub.mode         = subscribe         (hoặc unsubscribe)
hub.verify       = async
hub.secret       = {per-channel secret}
hub.lease_seconds= 432000            (~5 ngày; hub có thể trả về giá trị khác)
```

- **Giãn nhịp (stagger)** các request (vài chục ms/req) để tránh "bão re-subscribe".
- Hub gọi lại **GET** callback kèm `hub.challenge` → server echo → xác nhận. Lưu
  `subscribed_at` và `lease_expires_at` (= now + lease_seconds thực hub trả về).

### 4.3 Scheduler gia hạn
Job định kỳ (mỗi giờ) tìm kênh có `lease_expires_at` < now + 12h → re-subscribe lại,
kể cả khi URL không đổi.

### 4.4 Catch-up khi reconnect
Sau khi re-subscribe xong, poll RSS `feeds/videos.xml?channel_id=...` của từng kênh, so
với `last_video_published_at`, nạp video bị bỏ lỡ vào queue. Giúp app bền với downtime.

## 5. Endpoint Webhook

### GET `/webhook/youtube` — xác minh
Trả `hub.challenge` (HTTP 200, `text/plain`) khi có `hub.mode` + `hub.topic` hợp lệ.

### POST `/webhook/youtube` — nhận thông báo
1. Lấy **raw body** (cần cho HMAC) — dùng `express.raw` hoặc capture rawBody.
2. Verify `X-Hub-Signature: sha1=...` bằng HMAC-SHA1(rawBody, secret); sai → **403**.
3. Parse Atom XML, mỗi `<entry>` rút: `yt:videoId`, `yt:channelId`, `title`,
   `author/name`, `published`, `updated`. Nhận diện `at:deleted-entry`.
4. **Khử trùng theo `videoId`:**
   - Mới → insert `videos` (status=`new`) + enqueue tải.
   - Đã có & chỉ đổi metadata → update title, **không** tải lại.
   - `deleted-entry` → đánh dấu, không tải.
5. Trả **204** ngay; mọi xử lý nặng làm async (tránh hub retry).
6. Thumbnail tự dựng: `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg`.
7. Emit sự kiện Socket.io xuống UI.

## 6. Hàng đợi tải (Downloader)

- Queue **giới hạn song song** (mặc định 2–3 job).
- Lệnh: `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "<template>" <url>`.
  - Output template: `%(uploader)s/%(upload_date)s - %(title)s [%(id)s].%(ext)s`.
- **Parse tiến trình** qua `--newline` + `--progress-template` → đẩy % qua Socket.io.
- **Retry + backoff**: premiere/đang xử lý lỗi tạm → thử lại sau; giới hạn số lần
  (vd 5), ghi `error` khi hết lượt.
- Chống tải lặp: `--download-archive archive.txt` + cờ `status` trong DB.
- **Resolver nhập kênh**: nhận `@handle`/URL kênh/URL video/`UC...`; dùng
  `yt-dlp --print channel_id` để quy về channelId chuẩn trước khi lưu.

## 7. Dữ liệu (SQLite)

```sql
channels(
  channel_id TEXT PRIMARY KEY,      -- UC...
  handle TEXT, title TEXT, thumbnail TEXT,
  active INTEGER DEFAULT 1,
  secret TEXT,                      -- hub.secret riêng mỗi kênh
  subscribed_at INTEGER, lease_expires_at INTEGER,
  last_video_published_at INTEGER,
  created_at INTEGER
)

videos(
  video_id TEXT PRIMARY KEY,
  channel_id TEXT, title TEXT,
  published_at INTEGER, updated_at INTEGER,
  thumbnail_url TEXT,
  status TEXT,                      -- new|queued|downloading|done|failed|skipped
  download_path TEXT, retries INTEGER DEFAULT 0, error TEXT,
  created_at INTEGER
)

settings(key TEXT PRIMARY KEY, value TEXT)
-- webhook_port, mgmt_port, download_dir, max_concurrency, lease_seconds...
```

## 8. Quản lý tiến trình con & preflight (Windows)

- **Preflight khi khởi động**: kiểm tra có `cloudflared`, `yt-dlp`, `ffmpeg` (PATH hoặc
  thư mục `bin/`); thiếu → báo rõ trên UI, chặn các chức năng phụ thuộc.
- **Tắt sạch**: lưu PID tiến trình con; khi app thoát (SIGINT/SIGTERM/exit) gọi
  `taskkill /PID <pid> /T /F` để diệt cả cây tiến trình.
- Spawn qua `child_process.spawn`; chú ý quoting đường dẫn Windows.

## 9. Bảo mật (single-user local)

- **HMAC verify** trên webhook = bắt buộc (endpoint công khai).
- Management API + UI bind `127.0.0.1`, không tunnel.
- Không cần login. Mỗi kênh có `secret` riêng để cô lập rủi ro.

## 10. Cấu trúc thư mục

```
server/
  src/
    index.js            # bootstrap: preflight, mở 2 listener, DB, queue
    tunnel/             # spawn cloudflared, parse URL, watcher, health-check
    websub/             # subscribe/unsubscribe, verify GET, receive POST, parse Atom
    scheduler/          # gia hạn lease, catch-up RSS
    downloader/         # queue, yt-dlp spawn, parse %, retry, resolver
    db/                 # SQLite schema + truy vấn
    realtime/           # Socket.io event bus
  bin/                  # (tùy chọn) cloudflared.exe, yt-dlp.exe, ffmpeg.exe
client/                 # React + Vite + Tailwind + Lucide (dashboard SPA)
docs/superpowers/specs/ # tài liệu thiết kế
```

## 11. Roadmap (xếp lại để khử rủi ro sớm — vertical slice)

- **Phase 0 — Preflight & khung:** repo, dò binaries, schema SQLite, settings,
  skeleton 2 cổng.
- **Phase 1 — Tunnel core:** spawn cloudflared, parse URL chắc chắn, health-check,
  watcher đổi URL, trạng thái Online/Offline, tắt sạch tiến trình con.
- **Phase 2 — WebSub end-to-end (mấu chốt):** subscribe/unsubscribe + GET verify +
  POST (HMAC + parse Atom + dedup) + re-subscribe-all khi đổi URL + scheduler gia hạn.
  - **Mốc nghiệm thu:** đăng ký 1 kênh thật → nhận được 1 thông báo thật.
- **Phase 3 — Downloader:** queue + retry + parse %, resolver `@handle→UC`.
- **Phase 4 — UI:** React dashboard, Socket.io realtime, status tunnel, CRUD kênh,
  tiến trình tải, settings.
- **Phase 5 — Bền bỉ & hoàn thiện:** catch-up RSS khi reconnect, xử lý video xóa,
  mock-webhook test harness, script chạy/đóng gói.

Kiểm thử đan xuyên suốt (mock webhook khả dụng từ Phase 2), không dồn về cuối.

## 12. Ngoài phạm vi (YAGNI)

- Multi-user / auth / deploy server.
- Named Tunnel + domain ổn định (có thể bổ sung sau nếu cần độ bền cao hơn).
- Bộ lọc tải nâng cao (theo độ phân giải/loại/kênh) — hiện tại tải tất cả best quality.
- Đóng gói installer (.exe) — giai đoạn sau.

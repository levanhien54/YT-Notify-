# Dự án: YT-Notify Local Hub

## I. Thông tin chung
- **Tên ứng dụng:** YT-Notify Local Hub
- **Mục tiêu:** Xây dựng ứng dụng Desktop/Web-local quản lý và nhận thông báo (Webhook) từ YouTube thông qua Cloudflare Tunnel (cloudflared) với giao diện trực quan.
- **Mô hình hoạt động:** YouTube WebSub -> Cloudflare Tunnel -> Local Backend -> Local Frontend UI.

## II. Stack Công nghệ
| Thành phần | Công nghệ được chọn |
| :--- | :--- |
| **Backend (Core Server)** | Node.js (Express.js) |
| **Frontend (Giao diện UI)** | React.js (Vite), Tailwind CSS, Lucide Icons |
| **Networking/Tunnel** | cloudflared (Cloudflare Tunnel CLI) |
| **Database (Lưu trữ cục bộ)** | SQLite |
| **Downloader** | yt-dlp và ffmpeg |

## III. Danh sách Tính năng
1. **Quản lý kết nối (Tunnel Management):**
   - Khởi động/Dừng cloudflared trực tiếp từ giao diện.
   - Tự động trích xuất và hiển thị Public HTTPS URL từ Cloudflare (`*.trycloudflare.com`).
   - Hiển thị trạng thái kết nối (Online/Offline).

2. **Quản lý Kênh YouTube (Subscription):**
   - Thêm ID kênh YouTube cần theo dõi.
   - Tự động gửi yêu cầu đăng ký (Subscribe) hoặc hủy đăng ký (Unsubscribe) tới YouTube WebSub Hub.
   - Hiển thị danh sách các kênh đang theo dõi.

3. **Hiển thị Thông báo (Notification Feed):**
   - Nhận và phân tích dữ liệu XML/Atom từ YouTube Webhook.
   - Hiển thị danh sách video mới (Tiêu đề, Tên kênh, Thumbnail, Thời gian).
   - Truyền log/thông báo realtime xuống frontend qua Socket.io.

4. **Tải Video Tự động (Auto Download):**
   - Tự động kích hoạt `yt-dlp` để tải video về máy tính ngay khi nhận được thông báo video mới từ YouTube.
   - Báo cáo tiến trình tải (% hoàn thành) trên giao diện.

## IV. Cấu trúc Dự án
Dự án được chia thành 2 thư mục chính:
- `server/`: Chứa mã nguồn Backend (Node.js + Express), Database SQLite và các logic quản lý Cloudflare Tunnel, YouTube WebSub, tải video `yt-dlp`.
- `client/`: Chứa mã nguồn Frontend (React + Vite + Tailwind), giao diện hiển thị dạng Dashboard SPA.

## V. Yêu cầu Hệ thống (Prerequisites)
Để chạy dự án này trên môi trường Windows, máy tính cần có sẵn:
1. **Node.js** (phiên bản 18 trở lên).
2. **cloudflared.exe**: File thực thi của Cloudflare Tunnel.
3. **yt-dlp.exe** và **ffmpeg.exe**: Hai công cụ cốt lõi để tải video YouTube chất lượng cao và ghép file hình ảnh/âm thanh.

## VI. Lộ trình Thực hiện (Roadmap)
- **Phase 1: Setup & Backend**: Thiết lập Node.js server, tích hợp child_process chạy cloudflared, tạo API nhận Webhook.
- **Phase 2: YouTube WebSub**: Viết module gửi POST request subscribe kênh, thiết lập database lưu trữ và parse XML.
- **Phase 3: Video Downloader**: Tích hợp `yt-dlp`, tự động tải video khi có thông báo.
- **Phase 4: Giao diện (UI)**: Dựng React Dashboard, kết nối Socket.io để nhận sự kiện từ Backend.
- **Phase 5: Kiểm thử**: Chạy Mock Webhook để kiểm tra luồng nhận thông báo và tải video thành công.

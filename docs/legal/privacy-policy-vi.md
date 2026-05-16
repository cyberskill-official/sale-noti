# Chính sách bảo mật — SaleNoti

**Hiệu lực:** 2026-05-XX (sau khi DPIA được A05 tiếp nhận).
**Phiên bản:** v1.0.0
**Đơn vị kiểm soát dữ liệu:** CYBERSKILL SOFTWARE SOLUTIONS CONSULTANCY AND DEVELOPMENT JOINT STOCK COMPANY (CyberSkill JSC).
**DPO:** legal@salenoti.vn · (+84) 906 878 091
**Văn bản tham chiếu:** Nghị định 13/2023/NĐ-CP của Chính phủ.

---

## 1. Tóm tắt một phút

- SaleNoti là dịch vụ theo dõi giá sản phẩm Shopee Việt Nam. Khi bạn đăng ký, chúng tôi giữ email + danh sách sản phẩm bạn track + thiết lập alert. Chúng tôi gửi email/push/Telegram khi giá giảm theo trigger bạn cài đặt.
- Chúng tôi là affiliate publisher của Shopee Affiliate Open API. Khi bạn click vào deeplink trong alert hoặc trang public, chúng tôi nhận hoa hồng 1.5–5% (tùy ngành hàng). Bạn không trả thêm.
- Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn, bán dữ liệu cá nhân của bạn.
- Bạn có quyền: truy cập, sửa, xóa, hạn chế xử lý, phản đối, di chuyển dữ liệu (Điều 14–22 NĐ 13).
- Liên hệ DPO bất cứ lúc nào: legal@salenoti.vn

## 2. Dữ liệu chúng tôi thu thập

### 2.1 Khi bạn đăng ký

- **Email** — bắt buộc; dùng để đăng nhập + gửi alert.
- **Tên hiển thị** — chỉ nếu bạn đăng nhập qua Google OAuth (lấy từ profile Google `name`).
- **ID OAuth provider** (nếu dùng Google) — dùng để liên kết lần đăng nhập sau.

### 2.2 Khi bạn dùng dịch vụ

- **Sản phẩm bạn track** — URL shopee.vn bạn dán vào, cấu hình alert (kiểu trigger, ngưỡng %, target price).
- **Lịch sử alert** — alert được gửi đến bạn, alert được mở, alert được click. Lưu 365 ngày.
- **Địa chỉ IP, User-Agent** — cho mục đích chống lạm dụng. IP được rút ngắn về `/24` (IPv4) hoặc `/64` (IPv6) trong analytics.

### 2.3 Khi bạn cài Chrome extension

- **disclosureAcknowledgedAt** — timestamp xác nhận đã đọc disclosure; chỉ lưu local trong `chrome.storage`.
- Extension KHÔNG đọc cookie, KHÔNG override cookie affiliate publisher khác, KHÔNG inject script vào trang non-Shopee.

### 2.4 Khi bạn opt-in Web Push

- **Push subscription endpoint + keys** — do trình duyệt sinh ra; chúng tôi lưu để gửi push.

### 2.5 Khi bạn opt-in Telegram bot (Phase 2)

- **Telegram chat ID** — khi bạn bấm `/start <token>`. Bạn có thể gỡ bằng `/unsubscribe`.

### 2.6 Khi bạn nâng cấp Pro/Pro+ (Phase 2)

- **Stripe / VNPay / MoMo customer ID** — chúng tôi KHÔNG lưu số thẻ; số thẻ chỉ đi trực tiếp đến gateway qua redirect/iframe.

### 2.7 Chúng tôi KHÔNG thu thập

Địa chỉ nhà, ngày sinh, CCCD/CMND, MST cá nhân, thông tin sức khỏe, sinh trắc học, vị trí GPS, lịch sử duyệt web ngoài trang sản phẩm Shopee, danh bạ, Drive/Calendar/Photos của Google.

## 3. Cơ sở pháp lý (Điều 17 NĐ 13)

| Loại dữ liệu | Cơ sở pháp lý | Thời gian lưu |
|---|---|---|
| Email + tên + OAuth ID | Sự đồng ý của bạn khi đăng ký | Tài khoản đang dùng + 12 tháng sau khi xóa |
| Watchlist + cấu hình alert | Sự đồng ý + thực hiện hợp đồng (dịch vụ tracker) | Cùng như trên |
| Log alert (delivery + click) | Lợi ích hợp pháp (chống lạm dụng, audit attribution) | 365 ngày TTL |
| IP + UA | Lợi ích hợp pháp (chống lạm dụng) | 90 ngày (ext), 365 ngày (notif) |
| Push subscription | Sự đồng ý (bấm "Enable push") | Đến khi bạn revoke |
| Telegram chat ID | Sự đồng ý (bấm `/start`) | Đến khi `/unsubscribe` |
| Stripe / VNPay / MoMo ID | Thực hiện hợp đồng (Pro subscription) | Tài khoản đang dùng + 7 năm (yêu cầu thuế) |

## 4. Chia sẻ dữ liệu với bên thứ ba

Chúng tôi dùng các nhà cung cấp dịch vụ sau (ghi rõ vùng đặt máy chủ):

- **MongoDB Atlas** (Singapore) — lưu trữ hot data. SOC 2 Type II.
- **Vercel** (Hoa Kỳ — edge) — hosting frontend. SOC 2 Type II.
- **Railway** (Hoa Kỳ) — hosting backend + worker. SOC 2 đang đánh giá.
- **Resend** (Hoa Kỳ) — gửi email transactional + alert.
- **PostHog Cloud** (Hoa Kỳ) — product analytics. **PII của bạn được hash bằng sha256 + salt trước khi gửi sang.**
- **Sentry** (Hoa Kỳ) — error tracking. Email được redact thành `[redacted]` trước khi gửi.
- **Better Stack** (EU) — uptime monitoring. Không có PII.
- **Shopee Affiliate Open API** (Singapore) — sinh deeplink. **Không có PII đi ra; chỉ subIds là hash của userId.**
- **Telegram** (UAE) — bot notification, chỉ khi bạn opt-in.
- **Stripe** (Hoa Kỳ/Ireland) — billing (Phase 2).
- **VNPay** (Việt Nam) — billing (Phase 2).
- **MoMo** (Việt Nam) — billing (Phase 2).

Đánh giá tác động chuyển dữ liệu ra nước ngoài (Điều 25 NĐ 13): [`cross-border-transfer-impact-assessment.md`](cross-border-transfer-impact-assessment.md).

Chúng tôi KHÔNG bán hoặc chia sẻ dữ liệu cá nhân cho mục đích marketing với bên thứ ba.

## 5. Quyền của bạn (Điều 14–22 NĐ 13)

| Quyền | Cách thực hiện | Thời gian phản hồi |
|---|---|---|
| Truy cập dữ liệu (Điều 14) | Bấm "Xuất dữ liệu" trong dashboard / gửi email DPO | ≤ 30 ngày |
| Sửa dữ liệu sai (Điều 15) | Trực tiếp trong dashboard / liên hệ DPO | Tức thì |
| Xóa dữ liệu (Điều 16) | Bấm "Xóa tài khoản" trong dashboard | Soft-delete trong 24h, hard-purge trong 72h |
| Hạn chế xử lý (Điều 19) | Liên hệ DPO | ≤ 72 giờ |
| Di chuyển dữ liệu (Điều 18) | Bấm "Xuất dữ liệu" (file ZIP) | ≤ 30 ngày |
| Phản đối xử lý (Điều 20) | Liên hệ DPO | ≤ 72 giờ |
| Khiếu nại với cơ quan có thẩm quyền | A05 / Bộ Công an | n/a |

## 6. Bảo mật

### 6.1 Biện pháp kỹ thuật

- TLS 1.2+ mọi nơi (Vercel + Railway + Atlas mặc định bắt buộc).
- AES-256 encryption-at-rest (Atlas + Neon mặc định).
- Auth.js v5 với JWT rotation + reuse-detection (FR-AUTH-003).
- Tất cả secret quản lý qua Doppler; không commit `.env`.
- Rate limit trên mọi endpoint.

### 6.2 Biện pháp tổ chức

- DPO chuyên trách (Stephen Cheng — Founder).
- Quy trình thông báo sự cố A05 trong 72 giờ (template tại `A05-breach-notification-template.md`).
- Báo cáo Transparency hàng quý (https://salenoti.vn/transparency).
- Đào tạo PDPL nội bộ hàng năm.

### 6.3 Khi có sự cố

Nếu phát hiện vi phạm dữ liệu cá nhân, chúng tôi:

1. Thông báo A05 trong vòng 72 giờ.
2. Thông báo bạn (email) nếu sự cố có "rủi ro cao" theo Điều 33.
3. Khắc phục + cập nhật TOM trong vòng 7 ngày.

## 7. Cookie & tracking

Chúng tôi dùng các cookie sau:

- **`authjs.session-token`** — phiên đăng nhập (15 phút), HTTP-only Secure.
- **`authjs.refresh-token`** — refresh token (30 ngày), HTTP-only Secure, Path-scoped `/api/auth/refresh`.
- **`salenoti.pre_click_v1`** — đánh dấu bạn đã xem interstitial disclosure (30 ngày), giảm friction trong cùng phiên.
- **`salenoti.ref`** — referral cookie (30 ngày) nếu bạn vào qua link giới thiệu.

Chúng tôi KHÔNG dùng cookie tracking của bên quảng cáo.

## 8. Trẻ vị thành niên

SaleNoti không hướng đến người dưới 18 tuổi. Nếu bạn dưới 18, vui lòng không đăng ký. Nếu chúng tôi biết một tài khoản thuộc về người dưới 18, chúng tôi sẽ xóa tài khoản trong vòng 24 giờ.

## 9. Chuyển dữ liệu ra nước ngoài

Như mô tả tại §4, một số recipient đặt máy chủ ngoài Việt Nam. Cơ sở pháp lý (Điều 25 NĐ 13):

- Sự đồng ý của bạn (bạn tick "Tôi đồng ý" khi đăng ký).
- Recipient đảm bảo bảo vệ phù hợp (SOC 2 / ISO 27001 / GDPR-aligned).

Đánh giá đầy đủ tại [`cross-border-transfer-impact-assessment.md`](cross-border-transfer-impact-assessment.md).

## 10. Sửa đổi chính sách này

Khi chúng tôi sửa đổi chính sách, chúng tôi sẽ:

1. Đăng phiên bản mới tại /privacy.
2. Gửi email thông báo trong vòng 7 ngày trước hiệu lực (nếu có thay đổi quan trọng).
3. Yêu cầu bạn re-consent qua checkbox vào lần đăng nhập kế tiếp.

Trường `policyVersion` trong `users.consents` của bạn ghi lại phiên bản bạn đã đồng ý.

## 11. Liên hệ

- **DPO:** legal@salenoti.vn · (+84) 906 878 091
- **Văn phòng:** 1st Floor, 207A Nguyen Van Thu Street, Tan Dinh Ward, Ho Chi Minh City.
- **Cơ quan có thẩm quyền (khiếu nại):** Cục An ninh mạng và Phòng chống tội phạm sử dụng công nghệ cao (A05), Bộ Công an.

---

**Phiên bản v1.0.0 — 2026-05-XX.**
**Tham chiếu:** Privacy Policy English version tại `/privacy?lang=en` (`privacy-policy-en.md`).
**DPIA:** [`DPIA-2026-05.md`](DPIA-2026-05.md).

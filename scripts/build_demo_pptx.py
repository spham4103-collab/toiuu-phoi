from pathlib import Path
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

ROOT = Path(__file__).resolve().parent.parent
SHOTS_DIR = ROOT / "demo_screenshots"
OUT_PPTX = SHOTS_DIR / "Gioi_thieu_WMS_An_Binh_xepphoi_cloud.pptx"

TEAL_DARK = RGBColor(11, 59, 56)     # #0B3B38
TEAL_MAIN = RGBColor(15, 118, 110)   # #0F766E
TEAL_LIGHT = RGBColor(240, 253, 250) # #F0FDFA
ORANGE = RGBColor(194, 65, 12)       # #C2410C
SLATE = RGBColor(51, 65, 85)         # #334155
WHITE = RGBColor(255, 255, 255)
BORDER = RGBColor(203, 213, 225)

SLIDES = [
    ("01_tong_quan_dashboard.png", "Bước 1 · Tổng Quan Dashboard Điều Hành",
     "Theo dõi toàn bộ KPI kho, đơn hàng, PR/PO, thành phẩm & bảng 'Phôi Đã Về Kho — Sẵn Sàng Lĩnh'."),
    ("02_tao_don_va_tai_ban_ve_pdf.png", "Bước 2 · Tạo Đơn Hàng & Tải Bản Vẽ PDF",
     "Tạo đơn TGTB — Dưỡng kiểm tra retainer K-914D DL, đính kèm PDF bản vẽ & bàn giao sang Kinh doanh."),
    ("03_kinh_doanh_import_excel_dnmvt01.png", "Bước 3 · Import Chuẩn Biểu Mẫu ĐNMVT01",
     "Tự động nhận diện file Excel ĐNMVT01, bóc tách Khách hàng TGTB & gom chuẩn 6 dòng phôi (Phôi thô + KT Tinh)."),
    ("04_bang_bom_den_giao_thong.png", "Bước 4 · Đèn Giao Thông 4 Trạng Thái Vật Tư",
     "Hiển thị trực quan 4 bước quy trình & trạng thái từng phôi: 🟢 Sẵn sàng · 🟡 Đang về · 🔴 Chờ mua · ⚪ Đã xuất SX."),
    ("05_mau_in_dnmvt01_kem_qr.png", "Bước 5 · In Phiếu ĐNMVT01 Kèm Mã QR (A4)",
     "Biểu mẫu A4 chuẩn An Bình có Mã QR (XP:PROJ:<id>) kẹp bản vẽ & đủ 4 ô chữ ký phê duyệt."),
    ("06_kho_giu_phoi_va_lap_po.png", "Bước 6 · Giữ Phôi Có Sẵn & Lập PO Mua Hàng",
     "Thủ kho giữ phôi thừa đích danh cho đơn; phần thiếu đẩy PR -> PO kèm ngày hẹn giao dự kiến."),
    ("07_nhap_kho_pnk_va_bao_zalo.png", "Bước 7 · Duyệt PNK & Báo Nhóm Zalo 1 Chạm",
     "Duyệt nhập kho tự giữ hàng cho đơn, bật hộp thoại soạn sẵn tin Zalo & nút Xuất thẳng (Cross-docking)."),
    ("08_san_xuat_quet_qr_dien_thoai.png", "Bước 8 · Sản Xuất Quét QR Trên Điện Thoại",
     "Cầm phiếu kẹp bản vẽ quét QR bằng điện thoại để xem ngay vị trí kệ phôi đã về & tải bản vẽ số."),
    ("09_xuat_kho_pxk_va_bao_cao.png", "Bước 9 · Duyệt PXK & Báo Cáo Giá Vốn Tự Động",
     "Xuất kho giải phóng phôi giữ, hạch toán giá vốn bình quân gia quyền & tổng hợp tức thời trên Báo cáo NXT.")
]


def add_header_bar(slide, title_text, subtitle_text=""):
    bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(13.333), Inches(1.05))
    bar.fill.solid()
    bar.fill.fore_color.rgb = TEAL_DARK
    bar.line.fill.background()

    tb = slide.shapes.add_textbox(Inches(0.5), Inches(0.14), Inches(12.3), Inches(0.8))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title_text
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = WHITE
    if subtitle_text:
        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.size = Pt(13)
        p2.font.color.rgb = RGBColor(204, 251, 241)


def add_picture_fit(slide, img_path, left, top, max_w, max_h):
    with Image.open(img_path) as im:
        iw, ih = im.size
    ratio = min(max_w / iw, max_h / ih)
    w = iw * ratio
    h = ih * ratio
    x = left + (max_w - w) / 2
    y = top + (max_h - h) / 2
    slide.shapes.add_picture(str(img_path), x, y, width=w, height=h)


def main():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    # Slide 1: Cover
    s1 = prs.slides.add_slide(blank)
    bg = s1.shapes.add_shape(1, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
    bg.fill.solid()
    bg.fill.fore_color.rgb = TEAL_DARK
    bg.line.fill.background()

    accent = s1.shapes.add_shape(1, Inches(0), Inches(6.95), Inches(13.333), Inches(0.55))
    accent.fill.solid()
    accent.fill.fore_color.rgb = TEAL_MAIN
    accent.line.fill.background()

    tb = s1.shapes.add_textbox(Inches(0.9), Inches(1.8), Inches(11.5), Inches(4.0))
    tf = tb.text_frame
    tf.word_wrap = True
    p0 = tf.paragraphs[0]
    p0.text = "CÔNG TY CỔ PHẦN CƠ KHÍ VÀ DỊCH VỤ THƯƠNG MẠI AN BÌNH"
    p0.font.size = Pt(16)
    p0.font.bold = True
    p0.font.color.rgb = RGBColor(153, 246, 228)

    p1 = tf.add_paragraph()
    p1.text = "\nHỆ THỐNG QUẢN LÝ KHO & SẢN XUẤT (WMS)"
    p1.font.size = Pt(38)
    p1.font.bold = True
    p1.font.color.rgb = WHITE

    p2 = tf.add_paragraph()
    p2.text = "\nKhép kín quy trình: PO Khách hàng → Kỹ thuật → Kinh doanh (ĐNMVT01) → Kho → Mua hàng → Sản xuất"
    p2.font.size = Pt(20)
    p2.font.color.rgb = RGBColor(226, 232, 240)

    p3 = tf.add_paragraph()
    p3.text = "\nNền tảng: https://xepphoi.cloud  |  Minh họa thực tế đơn hàng TGTB — Dưỡng kiểm tra retainer K-914D DL"
    p3.font.size = Pt(14)
    p3.font.color.rgb = RGBColor(204, 251, 241)

    # Slide 2: 6-Role Workflow Overview
    s2 = prs.slides.add_slide(blank)
    add_header_bar(s2, "Tổng Quan Quy Trình Khép Kín 6 Vai Trò", "Đồng bộ dữ liệu Realtime trên Supabase cho toàn bộ phòng ban")
    boxes = [
        ("1. Kỹ Thuật (Engineer)", "Nhận PO khách hàng, tải bản vẽ PDF/CAD lên đơn & bấm Bàn giao cho Kinh doanh."),
        ("2. Kinh Doanh (Sales)", "Import Excel chuẩn ĐNMVT01 (tự gom Phôi thô + KT Tinh), in phiếu kèm QR & chuyển Kho/SX."),
        ("3. Thủ Kho (Warehouse)", "Bấm Giữ phôi có sẵn (Reservation), lập PR mua phần thiếu, duyệt PNK & báo Zalo 1 chạm."),
        ("4. Mua Hàng / Kế Toán", "Duyệt PR, phát hành PO kèm ngày hẹn giao (tự đồng bộ Đèn vàng trên đơn) & theo dõi công nợ."),
        ("5. Sản Xuất (Operator)", "Quét QR trên phiếu kẹp bản vẽ bằng điện thoại để xem kệ phôi đã về & tải bản vẽ số."),
        ("6. Ban Giám Đốc (Admin)", "Theo dõi Dashboard điều hành, Báo cáo NXT, Giá vốn theo dự án, Khóa kỳ & Audit Log.")
    ]
    for idx, (t, d) in enumerate(boxes):
        col = idx % 3
        row = idx // 3
        x = Inches(0.55 + col * 4.15)
        y = Inches(1.5 + row * 2.75)
        card = s2.shapes.add_shape(1, x, y, Inches(3.9), Inches(2.4))
        card.fill.solid()
        card.fill.fore_color.rgb = TEAL_LIGHT
        card.line.color.rgb = TEAL_MAIN
        card.line.width = Pt(1.5)
        ctb = s2.shapes.add_textbox(x + Inches(0.2), y + Inches(0.2), Inches(3.5), Inches(2.0))
        ctf = ctb.text_frame
        ctf.word_wrap = True
        cp1 = ctf.paragraphs[0]
        cp1.text = t
        cp1.font.size = Pt(17)
        cp1.font.bold = True
        cp1.font.color.rgb = TEAL_DARK
        cp2 = ctf.add_paragraph()
        cp2.text = "\n" + d
        cp2.font.size = Pt(13.5)
        cp2.font.color.rgb = SLATE

    # Slides 3-11: 9 Steps
    for img_name, title, desc in SLIDES:
        sl = prs.slides.add_slide(blank)
        add_header_bar(sl, title, desc)
        img_path = SHOTS_DIR / img_name
        if img_path.exists():
            add_picture_fit(sl, img_path, Inches(0.45), Inches(1.22), Inches(12.43), Inches(6.05))

    # Slide 12: Summary
    s12 = prs.slides.add_slide(blank)
    add_header_bar(s12, "Lợi Ích Đạt Được Khi Vận Hành Trên xepphoi.cloud", "Chuẩn hóa dữ liệu cơ khí — Giảm thất thoát — Tăng tốc độ giao hàng")
    points = [
        "• Đọc & In chuẩn biểu mẫu ĐNMVT01 của An Bình: gom đúng Phôi thô + KT Tinh, gắn Mã QR tra cứu tức thì.",
        "• Giữ hàng đích danh (Reservation): tách bạch Tồn thực tế / Đang giữ cho đơn / Khả dụng tự do, chống xuất nhầm phôi.",
        "• Đèn giao thông 4 trạng thái (⚪/🟢/🟡/🔴): Sản xuất & Kinh doanh biết ngay phôi ở kệ nào hoặc ngày dự kiến về.",
        "• Báo nhóm Zalo 1 chạm & Cross-docking: duyệt PNK xong báo ngay tổ Sản xuất cầm phiếu kẹp bản vẽ ra lĩnh phôi.",
        "• Khép kín Giá vốn Dự án & Kho Thành phẩm — Giao hàng: kiểm soát chặt chẽ từ PO khách hàng đến Biên bản bàn giao."
    ]
    tb12 = s12.shapes.add_textbox(Inches(0.8), Inches(1.6), Inches(11.7), Inches(5.2))
    tf12 = tb12.text_frame
    tf12.word_wrap = True
    for i, pt in enumerate(points):
        p = tf12.paragraphs[0] if i == 0 else tf12.add_paragraph()
        p.text = pt + "\n"
        p.font.size = Pt(18)
        p.font.color.rgb = TEAL_DARK

    prs.save(str(OUT_PPTX))
    print(f"[OK] Saved PowerPoint: {OUT_PPTX}")


if __name__ == "__main__":
    main()

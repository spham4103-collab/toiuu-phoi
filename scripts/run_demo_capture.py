import os
import sys
import time
import json
import uuid
import urllib.request
import urllib.error
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "demo_assets"
OUT_DIR = ROOT / "demo_screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PDF_FILE = ASSETS_DIR / "26-A-TGHP-01-52_Duong_kiem_tra_retainer_K914D_DL.pdf"
XLSX_FILE = ASSETS_DIR / "ĐNVT - Dưỡng kiểm tra retainer K-914D DL.xlsx"

DEMO_PROJ_NAME = "DEMO - Dưỡng kiểm tra retainer K-914D DL"
DEMO_CUSTOMER = "TGTB"
DEMO_PO_NO = "PO-TGTB-2026-0914"
DEMO_INV_NAME = f"DEMO-POM-270x25x80-{int(time.time())}"
DEMO_SUP_NAME = f"NCC-DEMO-{int(time.time())}"


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class SupaAdmin:
    def __init__(self, url, service_key):
        self.url = url.rstrip("/")
        self.key = service_key

    def req(self, method, path, body=None, extra_headers=None):
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        if extra_headers:
            headers.update(extra_headers)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(r, timeout=20) as resp:
                txt = resp.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            err_txt = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {path}: {err_txt}")

    def create_temp_admin(self):
        uname = f"demo_mgr_{int(time.time())}"
        email = f"{uname}@anbinh.local"
        pwd = f"Demo@{uuid.uuid4().hex[:10]}!"
        user_obj = self.req("POST", "/auth/v1/admin/users", {
            "email": email,
            "password": pwd,
            "email_confirm": True,
            "user_metadata": {"username": uname, "full_name": "Demo Quản Lý", "role": "admin"},
        })
        uid = user_obj["id"]
        self.req("POST", "/rest/v1/profiles", {
            "id": uid,
            "username": uname,
            "display_name": "Demo Quản Lý",
            "role": "admin",
        }, {"Prefer": "resolution=merge-duplicates,return=representation"})
        return uid, uname, pwd

    def delete_temp_user(self, uid):
        if not uid:
            return
        try:
            self.req("DELETE", f"/rest/v1/profiles?id=eq.{uid}")
        except Exception:
            pass
        try:
            self.req("DELETE", f"/auth/v1/admin/users/{uid}")
        except Exception:
            pass


def main():
    env = load_env()
    sb_url = env["SUPABASE_URL"]
    sb_service = env["SUPABASE_SECRET_KEY"]
    supa = SupaAdmin(sb_url, sb_service)

    port = 3099
    base_url = f"http://127.0.0.1:{port}"
    srv_env = os.environ.copy()
    srv_env["PORT"] = str(port)
    server_proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=str(ROOT),
        env=srv_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    temp_uid = None
    proj_id = None
    inv_id = None
    sup_id = None
    pr_id = None
    po_id = None
    pnk_id = None
    pnk_code = None
    pxk_id = None

    try:
        time.sleep(2.0)
        temp_uid, uname, pwd = supa.create_temp_admin()
        print(f"[INFO] Created temp admin user {uname}")

        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.5)
            page = context.new_page()
            def on_dialog(d):
                print("[DIALOG]", d.type, d.message)
                d.accept()
            page.on("dialog", on_dialog)
            page.on("pageerror", lambda err: print("[PAGEERROR]", err))
            page.on("console", lambda msg: print("[CONSOLE]", msg.type, msg.text) if msg.type == "error" else None)
            def on_resp(r):
                if r.status >= 400 and "supabase" in r.url:
                    try:
                        print("[HTTPERR]", r.status, r.url, r.text())
                    except Exception:
                        pass
            page.on("response", on_resp)

            # 1. Login & Step 1: Dashboard
            page.goto(base_url + "/", wait_until="networkidle")
            page.fill("#inpLoginUser", uname)
            page.fill("#inpLoginPass", pwd)
            page.click("#btnSubmitLogin")
            page.wait_for_selector("#managerDashboard", state="visible", timeout=20000)
            page.wait_for_timeout(1500)
            page.screenshot(path=str(OUT_DIR / "01_tong_quan_dashboard.png"), full_page=False)
            print("[OK] 01_tong_quan_dashboard.png")

            # 2. Step 2: /projects -> Create Demo Order -> Upload PDF -> Handover
            page.goto(base_url + "/projects", wait_until="networkidle")
            page.wait_for_selector("#btnCreateNewProj", state="visible", timeout=15000)
            page.click("#btnCreateNewProj")
            page.fill("#inpFormName", DEMO_PROJ_NAME)
            page.fill("#inpFormCustomer", DEMO_CUSTOMER)
            if page.locator("#inpFormCustomerPo").count() > 0:
                page.fill("#inpFormCustomerPo", DEMO_PO_NO)
            page.fill("#inpFormDueDate", "2026-12-05")
            page.click("#btnSaveModalForm")
            page.wait_for_selector("#modalProjForm", state="hidden", timeout=15000)

            # Find created project id via Supabase REST (with short retry)
            projs = []
            for _ in range(12):
                projs = supa.req("GET", f"/rest/v1/projects?name=eq.{urllib.request.quote(DEMO_PROJ_NAME)}&select=id") or []
                if projs:
                    break
                page.wait_for_timeout(500)
            proj_id = projs[0]["id"]

            # Open BOM modal for this project
            page.locator(f'.btn-open-bom[data-id="{proj_id}"]').click()
            page.wait_for_selector("#inpBomAttFile", state="attached", timeout=15000)
            page.wait_for_timeout(800)

            # Upload PDF drawing
            page.set_input_files("#inpBomAttFile", str(PDF_FILE))
            page.wait_for_timeout(2800)
            page.screenshot(path=str(OUT_DIR / "02_tao_don_va_tai_ban_ve_pdf.png"), full_page=False)
            print("[OK] 02_tao_don_va_tai_ban_ve_pdf.png")

            # Click Handover drawings if button exists
            if page.locator("#btnWfHandoverDrawings").count() > 0:
                page.click("#btnWfHandoverDrawings")
                page.wait_for_timeout(1500)

            # 3. Step 3: Import Excel ĐNMVT01 -> Screenshot Preview -> Confirm -> Submit to Warehouse/SX
            page.set_input_files("#inpBomImportExcel", str(XLSX_FILE))
            page.wait_for_selector("#btnConfirmImportPreview", state="visible", timeout=15000)
            page.wait_for_timeout(700)
            page.screenshot(path=str(OUT_DIR / "03_kinh_doanh_import_excel_dnmvt01.png"), full_page=False)
            print("[OK] 03_kinh_doanh_import_excel_dnmvt01.png")

            page.click("#btnConfirmImportPreview")
            page.wait_for_timeout(2500)
            if page.locator("#btnWfSubmitBom").count() > 0:
                page.click("#btnWfSubmitBom")
                page.wait_for_timeout(1500)

            # 4. Step 4: BOM table with 4-step workflow bar & 6 traffic-light rows
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT_DIR / "04_bang_bom_den_giao_thong.png"), full_page=False)
            print("[OK] 04_bang_bom_den_giao_thong.png")

            # 5. Step 5: Print A4 ĐNMVT01 with QR + 4 signatures
            with context.expect_page() as popup_info:
                page.click("#btnBomPrintReqA4")
            print_page = popup_info.value
            print_page.wait_for_load_state("domcontentloaded")
            print_page.set_viewport_size({"width": 980, "height": 1100})
            print_page.wait_for_timeout(800)
            print_page.screenshot(path=str(OUT_DIR / "05_mau_in_dnmvt01_kem_qr.png"), full_page=True)
            print_page.close()
            print("[OK] 05_mau_in_dnmvt01_kem_qr.png")

            # 6. Step 6: Seed 1 demo inventory item -> Allocate row 1 -> Create PR & PO for remaining
            inv_ins = supa.req("POST", "/rest/v1/inventory", {
                "profile_name": DEMO_INV_NAME,
                "category": "other",
                "material_group": "solid_cnc",
                "unit": "cái",
                "stock_qty": 5,
                "reserved_qty": 0,
                "rack_location": "Kệ CNC-B2",
                "unit_price": 450000,
                "avg_cost": 450000,
                "is_active": True,
            })
            inv_id = inv_ins[0]["id"]
            reqs = supa.req("GET", f"/rest/v1/project_material_requests?project_id=eq.{proj_id}&order=created_at.asc")
            req1_id = reqs[0]["id"]
            supa.req("PATCH", f"/rest/v1/project_material_requests?id=eq.{req1_id}", {"inventory_id": inv_id})

            # Allocate row 1 via RPC if available
            try:
                supa.req("POST", "/rest/v1/rpc/allocate_free_stock_to_request", {"p_request_id": req1_id, "p_qty": 1})
            except Exception:
                supa.req("PATCH", f"/rest/v1/project_material_requests?id=eq.{req1_id}", {"allocated_qty": 1})
                supa.req("PATCH", f"/rest/v1/inventory?id=eq.{inv_id}", {"reserved_qty": 1})

            # Create demo supplier, PR & PO for remaining items (rows 2..6)
            sup_ins = supa.req("POST", "/rest/v1/suppliers", {"name": DEMO_SUP_NAME, "phone": "0904000111"})
            sup_id = sup_ins[0]["id"]
            pr_ins = supa.req("POST", "/rest/v1/purchase_requests", {
                "pr_code": f"PR-DEMO-{int(time.time())}",
                "title": f"Mua phôi {DEMO_PROJ_NAME}",
                "project_id": proj_id,
                "department": "Kinh doanh / Kho",
                "priority": "urgent",
                "needed_date": "2026-12-01",
                "status": "ordered",
                "created_by": uname,
            })
            pr_id = pr_ins[0]["id"]
            po_ins = supa.req("POST", "/rest/v1/purchase_orders", {
                "po_code": f"PO-DEMO-{int(time.time())}",
                "pr_id": pr_id,
                "supplier_id": sup_id,
                "project_id": proj_id,
                "order_date": "2026-11-25",
                "expected_date": "2026-11-29",
                "status": "sent",
                "total_amount": 1850000,
                "created_by": uname,
            })
            po_id = po_ins[0]["id"]

            for r in reqs[1:]:
                pri = supa.req("POST", "/rest/v1/purchase_request_items", {
                    "pr_id": pr_id,
                    "project_request_id": r["id"],
                    "item_name": r["item_name"],
                    "unit": r["unit"],
                    "requested_qty": r["required_qty"],
                    "estimated_price": 300000,
                })
                supa.req("POST", "/rest/v1/purchase_order_items", {
                    "po_id": po_id,
                    "pr_item_id": pri[0]["id"],
                    "item_name": r["item_name"],
                    "unit": "cái",
                    "ordered_qty": r["required_qty"],
                    "unit_price": 300000,
                    "total_amount": float(r["required_qty"]) * 300000,
                })

            page.goto(base_url + "/purchasing?tab=po", wait_until="networkidle")
            page.wait_for_selector("#poTableBody tr", timeout=15000)
            page.wait_for_timeout(1200)
            page.screenshot(path=str(OUT_DIR / "06_kho_giu_phoi_va_lap_po.png"), full_page=False)
            print("[OK] 06_kho_giu_phoi_va_lap_po.png")

            # 7. Step 7: /vouchers?new=IN&po=<po_id> -> Save & Approve PNK -> Capture Zalo Ready Modal
            page.goto(base_url + f"/vouchers?new=IN&po={po_id}", wait_until="domcontentloaded")
            page.wait_for_selector("#modalVoucherForm.open", timeout=25000)
            page.wait_for_timeout(1500)
            page.click("#btnSaveVoucher")
            page.wait_for_timeout(2000)

            pnks = supa.req("GET", f"/rest/v1/warehouse_vouchers?po_id=eq.{po_id}&select=id,voucher_code")
            pnk_id = pnks[0]["id"]
            pnk_code = pnks[0]["voucher_code"]
            # Open view modal and approve via UI button so Zalo modal pops up automatically
            page.goto(base_url + f"/vouchers?id={pnk_id}", wait_until="networkidle")
            page.wait_for_selector("#modalVoucherView.open", timeout=15000)
            page.wait_for_timeout(600)
            approve_btn = page.locator("#modalVoucherView button:has-text('Duyệt')").first
            approve_btn.click()
            page.wait_for_selector("#xpZaloReadyModal", state="visible", timeout=15000)
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT_DIR / "07_nhap_kho_pnk_va_bao_zalo.png"), full_page=False)
            print("[OK] 07_nhap_kho_pnk_va_bao_zalo.png")

            # 8. Step 8: Mobile 390x844 QR Project Lookup
            page.set_viewport_size({"width": 390, "height": 844})
            page.goto(base_url + "/", wait_until="networkidle")
            page.wait_for_selector("#managerDashboard", state="visible", timeout=15000)
            page.evaluate(f"window.WorkshopQrScanner && window.WorkshopQrScanner.openProjectLookupModal('{proj_id}', {{ role: 'operator' }})")
            page.wait_for_selector("#xpQrProjLookupModal", state="visible", timeout=15000)
            page.wait_for_timeout(1500)
            page.screenshot(path=str(OUT_DIR / "08_san_xuat_quet_qr_dien_thoai.png"), full_page=False)
            print("[OK] 08_san_xuat_quet_qr_dien_thoai.png")

            # 9. Step 9: Back to 1440x900 -> Approve PXK -> /reports
            page.set_viewport_size({"width": 1440, "height": 900})
            pxk_ins = supa.req("POST", "/rest/v1/warehouse_vouchers", {
                "voucher_code": f"PXK-DEMO-{int(time.time())}",
                "voucher_type": "OUT",
                "status": "pending",
                "project_id": proj_id,
                "department": "Tổ Sản Xuất",
                "created_by": uname,
            })
            pxk_id = pxk_ins[0]["id"]
            supa.req("POST", "/rest/v1/warehouse_voucher_items", {
                "voucher_id": pxk_id,
                "inventory_id": inv_id,
                "project_request_id": req1_id,
                "profile": DEMO_INV_NAME,
                "material_group": "solid_cnc",
                "unit": "cái",
                "qty": 1,
                "unit_price": 450000,
            })
            page.goto(base_url + f"/vouchers?id={pxk_id}", wait_until="networkidle")
            page.wait_for_selector("#modalVoucherView.open", timeout=15000)
            page.locator("#modalVoucherView button:has-text('Duyệt')").first.click()
            page.wait_for_timeout(1800)

            page.goto(base_url + "/reports", wait_until="networkidle")
            page.wait_for_timeout(1800)
            page.screenshot(path=str(OUT_DIR / "09_xuat_kho_pxk_va_bao_cao.png"), full_page=False)
            print("[OK] 09_xuat_kho_pxk_va_bao_cao.png")

            browser.close()

    finally:
        print("[INFO] Cleaning up 100% demo data from Supabase...")
        for vid in [pxk_id, pnk_id]:
            if vid:
                try:
                    supa.req("DELETE", f"/rest/v1/inventory_transactions?voucher_id=eq.{vid}")
                    supa.req("DELETE", f"/rest/v1/warehouse_voucher_items?voucher_id=eq.{vid}")
                    supa.req("DELETE", f"/rest/v1/warehouse_vouchers?id=eq.{vid}")
                except Exception:
                    pass
        if po_id:
            try:
                supa.req("DELETE", f"/rest/v1/purchase_order_items?po_id=eq.{po_id}")
                supa.req("DELETE", f"/rest/v1/purchase_orders?id=eq.{po_id}")
            except Exception:
                pass
        if pr_id:
            try:
                supa.req("DELETE", f"/rest/v1/purchase_request_items?pr_id=eq.{pr_id}")
                supa.req("DELETE", f"/rest/v1/purchase_requests?id=eq.{pr_id}")
            except Exception:
                pass
        if sup_id:
            try:
                supa.req("DELETE", f"/rest/v1/suppliers?id=eq.{sup_id}")
            except Exception:
                pass
        if proj_id:
            try:
                atts = supa.req("GET", f"/rest/v1/project_attachments?project_id=eq.{proj_id}&select=id,storage_path") or []
                for a in atts:
                    try:
                        supa.req("DELETE", f"/storage/v1/object/project-attachments/{a['storage_path']}")
                    except Exception:
                        pass
                supa.req("DELETE", f"/rest/v1/project_attachments?project_id=eq.{proj_id}")
                supa.req("DELETE", f"/rest/v1/wms_notifications?project_id=eq.{proj_id}")
                supa.req("DELETE", f"/rest/v1/project_material_requests?project_id=eq.{proj_id}")
                supa.req("DELETE", f"/rest/v1/projects?id=eq.{proj_id}")
            except Exception:
                pass
        if pnk_code:
            try:
                supa.req("DELETE", f"/rest/v1/inventory?notes=eq.{urllib.request.quote('Tự động tạo từ chứng từ ' + pnk_code)}")
            except Exception:
                pass
        if inv_id:
            try:
                supa.req("DELETE", f"/rest/v1/inventory_transactions?profile=eq.{urllib.request.quote(DEMO_INV_NAME)}")
                supa.req("DELETE", f"/rest/v1/inventory?id=eq.{inv_id}")
            except Exception:
                pass
        supa.delete_temp_user(temp_uid)
        server_proc.terminate()
        server_proc.wait(timeout=5)
        print("[OK] Cleanup complete.")


if __name__ == "__main__":
    main()

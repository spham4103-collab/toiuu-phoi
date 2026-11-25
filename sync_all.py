import shutil, os, json, re, zipfile, sys, hashlib

appdata_dir = os.environ.get('APPDATA') or r'C:\Users\Administrator\AppData\Roaming'
fusion_script_dir = os.path.join(appdata_dir, r'Autodesk\Autodesk Fusion 360\API\Scripts\Xuat_IGS_Va_Toi_Uu_Phoi')
toiuu_phoi_dir = r'C:\Users\Administrator\toiuu-phoi'
fusion_workspace_dir = r'C:\Users\Administrator\Fusion360\toiuu-phoi'
dist_dir = os.path.join(toiuu_phoi_dir, 'dist')

src_py = os.path.join(toiuu_phoi_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py')
src_html = os.path.join(toiuu_phoi_dir, 'index.html')
sub_branches = ['admin', 'projects', 'inventory', 'vouchers', 'reports', 'cnc']
wms_branches = ['admin', 'projects', 'inventory', 'vouchers', 'reports']
branch_htmls = [os.path.join(toiuu_phoi_dir, b + '.html') for b in sub_branches]
wms_branch_htmls = [os.path.join(toiuu_phoi_dir, b + '.html') for b in wms_branches]
src_engine = os.path.join(toiuu_phoi_dir, 'toi-uu-engine.js')
src_helper = os.path.join(toiuu_phoi_dir, 'run_engine_helper.cjs')
src_logo = os.path.join(toiuu_phoi_dir, 'logo_an_binh.jpg')
src_server = os.path.join(toiuu_phoi_dir, 'server.js')
src_cfg = os.path.join(toiuu_phoi_dir, 'workshop_config.json')
src_manifest = os.path.join(toiuu_phoi_dir, 'manifest.json')
src_sw = os.path.join(toiuu_phoi_dir, 'sw.js')

all_web_assets = [src_html] + branch_htmls + [src_engine, src_helper, src_logo, src_cfg, src_server, src_manifest, src_sw]

def sha256_short(fp):
    if not os.path.isfile(fp):
        return None
    h = hashlib.sha256()
    with open(fp, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()[:12]

def remove_stale_clean_subdirs(target_dir):
    removed = []
    for b in sub_branches:
        b_dir = os.path.join(target_dir, b)
        if os.path.isdir(b_dir):
            shutil.rmtree(b_dir, ignore_errors=True)
            removed.append(b)
    return removed

def copy_db_files(target_dir, include_json=False):
    src_db_dir = os.path.join(toiuu_phoi_dir, 'database')
    dst_db_dir = os.path.join(target_dir, 'database')
    if os.path.exists(dst_db_dir):
        for stale_name in ('workshop_db.js', 'workshop_db.json'):
            stale_path = os.path.join(dst_db_dir, stale_name)
            if os.path.exists(stale_path) and (stale_name == 'workshop_db.js' or not include_json):
                os.remove(stale_path)
    if include_json:
        os.makedirs(dst_db_dir, exist_ok=True)
        src_json = os.path.join(src_db_dir, 'workshop_db.json')
        if os.path.exists(src_json):
            shutil.copy2(src_json, os.path.join(dst_db_dir, 'workshop_db.json'))
    elif os.path.exists(dst_db_dir) and not os.listdir(dst_db_dir):
        os.rmdir(dst_db_dir)

def copy_js_files(target_dir, exclude_index=False):
    src_js_dir = os.path.join(toiuu_phoi_dir, 'js')
    dst_js_dir = os.path.join(target_dir, 'js')
    if os.path.exists(src_js_dir):
        if exclude_index:
            shutil.copytree(
                src_js_dir,
                dst_js_dir,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('index', 'index.*')
            )
            stale_idx = os.path.join(dst_js_dir, 'index')
            if os.path.isdir(stale_idx):
                shutil.rmtree(stale_idx, ignore_errors=True)
        else:
            shutil.copytree(src_js_dir, dst_js_dir, dirs_exist_ok=True)

def copy_css_files(target_dir, wms_only=False):
    src_css_dir = os.path.join(toiuu_phoi_dir, 'css')
    dst_css_dir = os.path.join(target_dir, 'css')
    if os.path.exists(src_css_dir):
        if wms_only:
            shutil.copytree(
                src_css_dir,
                dst_css_dir,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('index.css', 'print-a4.css')
            )
            for stale_css in ('index.css', 'print-a4.css'):
                p = os.path.join(dst_css_dir, stale_css)
                if os.path.exists(p):
                    os.remove(p)
        else:
            shutil.copytree(src_css_dir, dst_css_dir, dirs_exist_ok=True)

def sync_fusion_appdata():
    os.makedirs(fusion_script_dir, exist_ok=True)
    py_in_fusion = os.path.join(fusion_script_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py')
    if os.path.exists(src_py):
        shutil.copy2(src_py, py_in_fusion)
        print('Copied Xuat_IGS_Va_Toi_Uu_Phoi.py to Fusion Script dir')

    for extra_fn in ('Xuat_IGS_Va_Toi_Uu_Phoi.manifest', 'HUONG_DAN_CAI_DAT.txt'):
        src_extra = os.path.join(toiuu_phoi_dir, extra_fn)
        if os.path.exists(src_extra):
            shutil.copy2(src_extra, os.path.join(fusion_script_dir, extra_fn))

    for f in all_web_assets:
        if os.path.exists(f):
            shutil.copy2(f, os.path.join(fusion_script_dir, os.path.basename(f)))
    remove_stale_clean_subdirs(fusion_script_dir)
    copy_db_files(fusion_script_dir, include_json=True)
    copy_js_files(fusion_script_dir)
    copy_css_files(fusion_script_dir)

    stale_helper = os.path.join(fusion_script_dir, 'run_engine_helper.js')
    if os.path.exists(stale_helper):
        os.remove(stale_helper)
        print('Removed stale run_engine_helper.js from Fusion Script dir')

    print('Copied web assets to Fusion Script dir:', fusion_script_dir)
    for fn in ('Xuat_IGS_Va_Toi_Uu_Phoi.py', 'Xuat_IGS_Va_Toi_Uu_Phoi.manifest', 'run_engine_helper.cjs', 'toi-uu-engine.js'):
        h_repo = sha256_short(os.path.join(toiuu_phoi_dir, fn))
        h_app = sha256_short(os.path.join(fusion_script_dir, fn))
        print(f'  [SHA256] {fn}: repo={h_repo} appData={h_app} match={h_repo == h_app}')

def pack_fusion_portable():
    zip_target = os.path.join(toiuu_phoi_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi_Portable.zip')
    required_files = [
        'Xuat_IGS_Va_Toi_Uu_Phoi.py',
        'Xuat_IGS_Va_Toi_Uu_Phoi.manifest',
        'run_engine_helper.cjs',
        'toi-uu-engine.js',
        'HUONG_DAN_CAI_DAT.txt'
    ]

    missing = [fn for fn in required_files if not os.path.exists(os.path.join(toiuu_phoi_dir, fn))]
    if missing:
        print(f"❌ Lỗi: Thiếu file khi đóng gói Fusion Portable: {missing}")
        sys.exit(1)

    with zipfile.ZipFile(zip_target, 'w', zipfile.ZIP_DEFLATED) as z:
        for fn in required_files:
            fp = os.path.join(toiuu_phoi_dir, fn)
            # Thêm vào trong folder Xuat_IGS_Va_Toi_Uu_Phoi/ để giải nén trực tiếp vào thư mục Scripts của Fusion
            z.write(fp, f"Xuat_IGS_Va_Toi_Uu_Phoi/{fn}")

    # Quét bảo mật kiểm tra nội dung file nén
    with zipfile.ZipFile(zip_target, 'r') as z:
        namelist = z.namelist()
        for bad in ('.env', 'auth_session.json', 'workshop_db.json', 'sb_secret'):
            if any(bad in n for n in namelist):
                os.remove(zip_target)
                print(f"❌ Lỗi bảo mật: phát hiện file cấm '{bad}' trong file nén!")
                sys.exit(1)

    fsize_kb = os.path.getsize(zip_target) / 1024
    print(f"✅ ĐÃ ĐÓNG GÓI THÀNH CÔNG: {zip_target} ({fsize_kb:.1f} KB)")
    print(f"   Bao gồm {len(required_files)} file sạch: {', '.join(required_files)}")
    print(f"   Cấu trúc giải nén chuẩn Fusion: Xuat_IGS_Va_Toi_Uu_Phoi/*")

if '--pack-fusion' in sys.argv[1:]:
    pack_fusion_portable()
    sys.exit(0)

if '--fusion-only' in sys.argv[1:]:
    sync_fusion_appdata()
    print('Fusion 360 AppData synchronization completed!')
    sys.exit(0)

# 0. Dọn thư mục con trùng lặp (tận dụng extensionless URL GitHub Pages)
removed_root = remove_stale_clean_subdirs(toiuu_phoi_dir)
if removed_root:
    print('Removed duplicate clean-URL sub-directories:', ', '.join(removed_root))

# 1. Build bản WMS sạch sang thư mục dist/ cho GitHub Pages deploy (không copy code xếp phôi/Fusion/workshop_db.json/.netlify)
os.makedirs(dist_dir, exist_ok=True)
for stale_dir in ('.netlify', 'js/index'):
    p = os.path.join(dist_dir, stale_dir)
    if os.path.exists(p):
        shutil.rmtree(p, ignore_errors=True)
for stale_file in ('toi-uu-engine.js', 'run_engine_helper.cjs', 'Xuat_IGS_Va_Toi_Uu_Phoi.py'):
    p = os.path.join(dist_dir, stale_file)
    if os.path.exists(p):
        os.remove(p)

for f in [src_html] + wms_branch_htmls + [src_logo, src_cfg, src_manifest, src_sw]:
    if os.path.exists(f):
        shutil.copy2(f, os.path.join(dist_dir, os.path.basename(f)))

# Trang redirect cho bookmark cũ /cnc và /nesting
redirect_html = """<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang chuyển hướng...</title><script>
var target = (location.search && /[?&]project=/.test(location.search)) ? ('/projects' + location.search + location.hash) : '/';
location.replace(target);
</script></head><body></body></html>"""
for legacy_name in ('cnc.html', 'nesting.html'):
    with open(os.path.join(dist_dir, legacy_name), 'w', encoding='utf-8') as rf:
        rf.write(redirect_html)

remove_stale_clean_subdirs(dist_dir)
copy_db_files(dist_dir, include_json=False)
copy_js_files(dist_dir, exclude_index=True)
copy_css_files(dist_dir, wms_only=True)
print('Copied WMS web assets to dist dir (archived Fusion/Nesting excluded)')

# 5. Dọn dẹp các thư mục xuất trên Desktop: đảm bảo chỉ lưu lại đúng các file .igs
desktop_roots = [
    r'C:\Users\Administrator\Desktop\TEST',
    r'C:\Users\Administrator\Desktop\TEST 2'
]

candidate_dirs = []
for d_root in desktop_roots:
    if os.path.isdir(d_root):
        for sub in os.listdir(d_root):
            p = os.path.join(d_root, sub)
            if os.path.isdir(p):
                candidate_dirs.append(p)

for target_stale_dir in (fusion_script_dir, fusion_workspace_dir):
    stale_helper = os.path.join(target_stale_dir, 'run_engine_helper.js')
    if os.path.exists(stale_helper):
        os.remove(stale_helper)

for desktop_dir in candidate_dirs:
    if os.path.isdir(desktop_dir):
        for item in os.listdir(desktop_dir):
            fp = os.path.join(desktop_dir, item)
            if os.path.isdir(fp):
                shutil.rmtree(fp, ignore_errors=True)
            elif not item.lower().endswith('.igs'):
                try:
                    os.remove(fp)
                except Exception:
                    pass
        print('Cleaned non-IGS files from', desktop_dir)

# 6. Update zip package
zip_path = r'C:\Users\Administrator\Fusion360\toiuu-phoi-an-binh.zip'
if os.path.exists(zip_path):
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in os.listdir(toiuu_phoi_dir):
            fp = os.path.join(toiuu_phoi_dir, f)
            if os.path.isfile(fp):
                z.write(fp, f)
    print('Updated toiuu-phoi-an-binh.zip!')
print('All synchronization completed!')

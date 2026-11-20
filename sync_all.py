import shutil, os, json, re, zipfile

fusion_script_dir = r'C:\Users\Administrator\AppData\Roaming\Autodesk\Autodesk Fusion 360\API\Scripts\Xuat_IGS_Va_Toi_Uu_Phoi'
toiuu_phoi_dir = r'C:\Users\Administrator\toiuu-phoi'
fusion_workspace_dir = r'C:\Users\Administrator\Fusion360\toiuu-phoi'
dist_dir = os.path.join(toiuu_phoi_dir, 'dist')

src_py = os.path.join(toiuu_phoi_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py')
src_html = os.path.join(toiuu_phoi_dir, 'index.html')
sub_branches = ['admin', 'projects', 'inventory', 'cnc']
branch_htmls = [os.path.join(toiuu_phoi_dir, b + '.html') for b in sub_branches]
src_engine = os.path.join(toiuu_phoi_dir, 'toi-uu-engine.js')
src_helper = os.path.join(toiuu_phoi_dir, 'run_engine_helper.js')
src_logo = os.path.join(toiuu_phoi_dir, 'logo_an_binh.jpg')
src_server = os.path.join(toiuu_phoi_dir, 'server.js')
src_cfg = os.path.join(toiuu_phoi_dir, 'workshop_config.json')
src_manifest = os.path.join(toiuu_phoi_dir, 'manifest.json')
src_sw = os.path.join(toiuu_phoi_dir, 'sw.js')

all_web_assets = [src_html] + branch_htmls + [src_engine, src_helper, src_logo, src_cfg, src_server, src_manifest, src_sw]

# 0. Đồng bộ <branch>.html -> <branch>/index.html để hỗ trợ cả URL sạch (/projects/, /cnc/...)
for b in sub_branches:
    b_src = os.path.join(toiuu_phoi_dir, b + '.html')
    if os.path.exists(b_src):
        b_dir = os.path.join(toiuu_phoi_dir, b)
        os.makedirs(b_dir, exist_ok=True)
        shutil.copy2(b_src, os.path.join(b_dir, 'index.html'))
print('Synced clean-URL sub-directories:', ', '.join(sub_branches))

def copy_branches_to(target_dir):
    for b in sub_branches:
        b_src = os.path.join(toiuu_phoi_dir, b + '.html')
        if os.path.exists(b_src):
            sub_d = os.path.join(target_dir, b)
            os.makedirs(sub_d, exist_ok=True)
            shutil.copy2(b_src, os.path.join(sub_d, 'index.html'))

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

def copy_js_files(target_dir):
    src_js_dir = os.path.join(toiuu_phoi_dir, 'js')
    dst_js_dir = os.path.join(target_dir, 'js')
    if os.path.exists(src_js_dir):
        shutil.copytree(src_js_dir, dst_js_dir, dirs_exist_ok=True)

def copy_css_files(target_dir):
    src_css_dir = os.path.join(toiuu_phoi_dir, 'css')
    dst_css_dir = os.path.join(target_dir, 'css')
    if os.path.exists(src_css_dir):
        shutil.copytree(src_css_dir, dst_css_dir, dirs_exist_ok=True)

# 1. Đồng bộ script Python sang Fusion Script dir
py_in_fusion = os.path.join(fusion_script_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py')
if os.path.exists(src_py):
    shutil.copy2(src_py, py_in_fusion)
    print('Copied Xuat_IGS_Va_Toi_Uu_Phoi.py to Fusion Script dir')

# 2. Copy web assets to Fusion Script dir
for f in all_web_assets:
    if os.path.exists(f):
        shutil.copy2(f, os.path.join(fusion_script_dir, os.path.basename(f)))
copy_branches_to(fusion_script_dir)
copy_db_files(fusion_script_dir, include_json=True)
copy_js_files(fusion_script_dir)
copy_css_files(fusion_script_dir)
print('Copied web assets to Fusion Script dir')

# 3. Copy web assets to Fusion360/toiuu-phoi
os.makedirs(fusion_workspace_dir, exist_ok=True)
for f in all_web_assets + [src_py]:
    if os.path.exists(f):
        shutil.copy2(f, os.path.join(fusion_workspace_dir, os.path.basename(f)))
copy_branches_to(fusion_workspace_dir)
copy_db_files(fusion_workspace_dir, include_json=True)
copy_js_files(fusion_workspace_dir)
copy_css_files(fusion_workspace_dir)
print('Copied web assets to Fusion360/toiuu-phoi')

# 4. Copy web assets to dist directory for GitHub Pages deploy (tuyệt đối không copy workshop_db.json / .netlify)
os.makedirs(dist_dir, exist_ok=True)
stale_dist_netlify = os.path.join(dist_dir, '.netlify')
if os.path.exists(stale_dist_netlify):
    shutil.rmtree(stale_dist_netlify, ignore_errors=True)
for f in [src_html] + branch_htmls + [src_engine, src_logo, src_cfg, src_manifest, src_sw]:
    if os.path.exists(f):
        shutil.copy2(f, os.path.join(dist_dir, os.path.basename(f)))
copy_branches_to(dist_dir)
copy_db_files(dist_dir, include_json=False)
copy_js_files(dist_dir)
copy_css_files(dist_dir)
print('Copied web assets to dist dir')

# 5. Update export folders on Desktop if they exist
with open(src_html, 'r', encoding='utf-8') as f:
    base_html = f.read()

candidate_dirs = [
    r'C:\Users\Administrator\Desktop\TEST\Bàn thao tác',
    r'C:\Users\Administrator\Desktop\TEST\Bàn thao tác 1500x600x770',
    r'C:\Users\Administrator\Desktop\TEST 2\Bàn thao tác'
]

for desktop_dir in candidate_dirs:
    if os.path.exists(desktop_dir):
        shutil.copy2(src_engine, os.path.join(desktop_dir, 'toi-uu-engine.js'))
        shutil.copy2(src_helper, os.path.join(desktop_dir, 'run_engine_helper.js'))
        copy_js_files(desktop_dir)
        copy_css_files(desktop_dir)
        
        json_path = os.path.join(desktop_dir, 'fusion_exported_project.json')
        html_content = base_html
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                json_str = json.dumps(data, ensure_ascii=False)
                embed_tag = '<script id="embeddedFusionData" type="application/json">' + json_str + '</script>'
                if '<script id="embeddedFusionData"' in html_content:
                    html_content = re.sub(
                        r'<script id="embeddedFusionData"[^>]*>.*?</script>',
                        lambda m: embed_tag,
                        html_content,
                        flags=re.DOTALL
                    )
                else:
                    html_content = html_content.replace('</head>', embed_tag + '\n</head>')
            except Exception as e:
                print('Error embedding json for', desktop_dir, e)

        dest_html = os.path.join(desktop_dir, 'index.html')
        with open(dest_html, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print('Updated', dest_html)

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

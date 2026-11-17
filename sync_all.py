import shutil, os, json, re, zipfile

fusion_script_dir = r'C:\Users\Administrator\AppData\Roaming\Autodesk\Autodesk Fusion 360\API\Scripts\Xuat_IGS_Va_Toi_Uu_Phoi'
toiuu_phoi_dir = r'C:\Users\Administrator\toiuu-phoi'
fusion_workspace_dir = r'C:\Users\Administrator\Fusion360\toiuu-phoi'

src_py = os.path.join(fusion_script_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py')
src_html = os.path.join(toiuu_phoi_dir, 'index.html')
src_engine = os.path.join(toiuu_phoi_dir, 'toi-uu-engine.js')
src_helper = os.path.join(toiuu_phoi_dir, 'run_engine_helper.js')
src_logo = os.path.join(toiuu_phoi_dir, 'logo_an_binh.jpg')

# 1. Copy script to toiuu-phoi
shutil.copy2(src_py, os.path.join(toiuu_phoi_dir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py'))
print('Copied Xuat_IGS_Va_Toi_Uu_Phoi.py to toiuu-phoi')

# 2. Copy helper & engine to fusion script dir
shutil.copy2(src_helper, os.path.join(fusion_script_dir, 'run_engine_helper.js'))
shutil.copy2(src_engine, os.path.join(fusion_script_dir, 'toi-uu-engine.js'))
shutil.copy2(src_html, os.path.join(fusion_script_dir, 'index.html'))
print('Copied run_engine_helper.js, toi-uu-engine.js, index.html to Fusion Script dir')

# 3. Copy web assets to Fusion360/toiuu-phoi
os.makedirs(fusion_workspace_dir, exist_ok=True)
for f in [src_html, src_engine, src_helper, src_logo]:
    if os.path.exists(f):
        shutil.copy2(f, os.path.join(fusion_workspace_dir, os.path.basename(f)))
print('Copied web assets to Fusion360/toiuu-phoi')

# 4. Update export folders on Desktop if they exist
with open(src_html, 'r', encoding='utf-8') as f:
    base_html = f.read()

candidate_dirs = [
    r'C:\Users\Administrator\Desktop\TEST\Bàn thao tác',
    r'C:\Users\Administrator\Desktop\TEST\Bàn thao tác 1500x600x770',
    r'C:\Users\Administrator\Desktop\TEST 2\Bàn thao tác'
]

for desktop_dir in candidate_dirs:
    if os.path.exists(desktop_dir):
        # copy engine and helper
        shutil.copy2(src_engine, os.path.join(desktop_dir, 'toi-uu-engine.js'))
        shutil.copy2(src_helper, os.path.join(desktop_dir, 'run_engine_helper.js'))
        
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

# 5. Update zip package
zip_path = r'C:\Users\Administrator\Fusion360\toiuu-phoi-an-binh.zip'
if os.path.exists(zip_path):
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in os.listdir(toiuu_phoi_dir):
            fp = os.path.join(toiuu_phoi_dir, f)
            if os.path.isfile(fp):
                z.write(fp, f)
    print('Updated toiuu-phoi-an-binh.zip!')

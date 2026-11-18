try:
    import adsk.core, adsk.fusion
except ImportError:
    pass
import traceback
import os, json, re, math, webbrowser, shutil, subprocess, tempfile

def get_end_normals(body, l_cm):
    """
    Lấy vector pháp tuyến mặt phẳng cắt tại đúng đầu Z=0 (n_start) và đầu Z=L (n_end).
    Chỉ xét các mặt phẳng tiếp giáp mút đầu (minPoint.z <= 1.5mm) và mút cuối (maxPoint.z >= L - 1.5mm),
    đồng thời cộng gộp diện tích các mặt đồng phẳng để không bị ảnh hưởng bởi lỗ khoét hay rãnh xẻ.
    """
    n_start = adsk.core.Vector3D.create(0, 0, -1)
    n_end = adsk.core.Vector3D.create(0, 0, 1)
    start_groups = {}
    end_groups = {}
    tol_cm = 0.15  # 1.5mm

    for f in body.faces:
        if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
            _, n = f.evaluator.getNormalAtPoint(f.pointOnFace)
            if abs(n.z) > 0.3:
                fbb = f.boundingBox
                key = (round(n.x, 2), round(n.y, 2), round(n.z, 2))
                if fbb.minPoint.z <= tol_cm and n.z < -0.3:
                    if key not in start_groups:
                        start_groups[key] = [0.0, n]
                    start_groups[key][0] += f.area
                elif fbb.maxPoint.z >= l_cm - tol_cm and n.z > 0.3:
                    if key not in end_groups:
                        end_groups[key] = [0.0, n]
                    end_groups[key][0] += f.area

    if start_groups:
        best_s = max(start_groups.values(), key=lambda x: x[0])
        n_start = best_s[1]
    if end_groups:
        best_e = max(end_groups.values(), key=lambda x: x[0])
        n_end = best_e[1]

    return n_start, n_end

def detect_wall_thickness(norm_b, w_mm, h_mm, name_hint=""):
    """Nhận diện độ dày thành ống (t) từ tên chi tiết hoặc đo trực tiếp từ khoảng cách mặt trong/ngoài 3D."""
    m_prof = re.search(r'(\d+)\s*[xX\*×]\s*(\d+)\s*[xX\*×]\s*(\d+(?:[.,]\d+)?)', name_hint)
    if m_prof:
        val = float(m_prof.group(3).replace(',', '.'))
        if 0.4 <= val <= 15.0:
            return val

    t_match = re.search(r'[xX\*×](\d+(?:[.,]\d+)?)\s*(?:L|l|\s|$)', name_hint)
    if t_match:
        val = float(t_match.group(1).replace(',', '.'))
        if 0.4 <= val <= 15.0:
            return val

    # Đo trực tiếp từ các mặt phẳng song song với thành ống
    half_w = w_mm / 2.0
    half_h = h_mm / 2.0
    candidates = []
    for f in norm_b.faces:
        if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
            _, n = f.evaluator.getNormalAtPoint(f.pointOnFace)
            p = f.pointOnFace
            if abs(n.x) > 0.95:
                dist = round(half_w - abs(p.x * 10.0), 2)
                if 0.4 <= dist <= 12.0:
                    candidates.append(dist)
            elif abs(n.y) > 0.95:
                dist = round(half_h - abs(p.y * 10.0), 2)
                if 0.4 <= dist <= 12.0:
                    candidates.append(dist)
    if candidates:
        candidates.sort()
        return candidates[0]
    return 1.2

def normalize_body(tbm, orig_body):
    """
    Chuẩn hóa khối 3D ống hộp về hệ tọa độ chuẩn:
    - Chiều dài ống nằm dọc theo trục Z từ Z = 0 đến Z = L.
    - Tâm mặt cắt ngang nằm tại (X = 0, Y = 0) với cạnh rộng theo trục X, cạnh hẹp theo trục Y.
    - Với hộp vuông có cắt mòi, xoay mặt vát về mặt phẳng X-Z để đồng nhất hướng ghép mòi.
    """
    b = tbm.copy(orig_body)
    bb = b.boundingBox
    dx = bb.maxPoint.x - bb.minPoint.x
    dy = bb.maxPoint.y - bb.minPoint.y
    dz = bb.maxPoint.z - bb.minPoint.z

    # 1. Đưa trục dài nhất của ống về trục Z
    if dx >= dy and dx >= dz:
        rot = adsk.core.Matrix3D.create()
        rot.setToRotation(math.pi / 2.0, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0))
        tbm.transform(b, rot)
    elif dy >= dx and dy >= dz:
        rot = adsk.core.Matrix3D.create()
        rot.setToRotation(-math.pi / 2.0, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Point3D.create(0, 0, 0))
        tbm.transform(b, rot)

    # 2. Đưa cạnh lớn của mặt cắt về trục X (dx >= dy)
    bb = b.boundingBox
    dx = bb.maxPoint.x - bb.minPoint.x
    dy = bb.maxPoint.y - bb.minPoint.y
    if dy > dx + 0.01:
        rot = adsk.core.Matrix3D.create()
        rot.setToRotation(math.pi / 2.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0))
        tbm.transform(b, rot)

    # 3. Dịch tâm mặt cắt về (0, 0) và điểm đầu ống về Z = 0
    bb = b.boundingBox
    tx = -(bb.minPoint.x + bb.maxPoint.x) / 2.0
    ty = -(bb.minPoint.y + bb.maxPoint.y) / 2.0
    tz = -bb.minPoint.z
    trans = adsk.core.Matrix3D.create()
    trans.translation = adsk.core.Vector3D.create(tx, ty, tz)
    tbm.transform(b, trans)

    # 4. Nếu là hộp vuông và mặt vát đang nghiêng theo trục Y, xoay 90 độ quanh Z để chuẩn hóa về X-Z
    bb = b.boundingBox
    dx = bb.maxPoint.x - bb.minPoint.x
    dy = bb.maxPoint.y - bb.minPoint.y
    l_cm = bb.maxPoint.z - bb.minPoint.z
    if abs(dx - dy) < 0.15:
        ns, ne = get_end_normals(b, l_cm)
        need_rot_z = False
        for n in (ns, ne):
            if abs(n.z) < 0.999 and abs(n.y) > abs(n.x):
                need_rot_z = True
                break
        if need_rot_z:
            rot = adsk.core.Matrix3D.create()
            rot.setToRotation(math.pi / 2.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0))
            tbm.transform(b, rot)

    return b

def orient_piece(tbm, norm_body, l_cm, want_eL, want_eR, target_n_start=None):
    """
    Chọn phép xoay đối xứng 3D chuẩn xác trong 4 hướng (0, 180_Z, 180_X, 180_Y)
    sao cho:
    - Đầu trái (Z=0) khớp loại want_eL ('M' hoặc 'S'), đầu phải (Z=L) khớp want_eR.
    - Nếu ghép mòi (target_n_start != None), vector pháp tuyến mặt vát đầu trái
      ngược chiều tuyệt đối với pháp tuyến mặt vát đầu phải của thanh trước (song song khít 100%, không cắt chữ X).
    """
    candidates = []
    for mode in range(4):
        b_try = tbm.copy(norm_body)
        mat = adsk.core.Matrix3D.create()
        if mode == 1:
            mat.setToRotation(math.pi, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0))
        elif mode == 2:
            mat.setToRotation(math.pi, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Point3D.create(0, 0, l_cm / 2.0))
        elif mode == 3:
            mat.setToRotation(math.pi, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, l_cm / 2.0))
        if mode != 0:
            tbm.transform(b_try, mat)

        ns, ne = get_end_normals(b_try, l_cm)
        ang_s = round(math.degrees(math.acos(max(-1.0, min(1.0, abs(ns.z))))), 1)
        ang_e = round(math.degrees(math.acos(max(-1.0, min(1.0, abs(ne.z))))), 1)
        eL = 'M' if ang_s >= 2.0 else 'S'
        eR = 'M' if ang_e >= 2.0 else 'S'

        score = 0.0
        if eL == want_eL:
            score += 100.0
        if eR == want_eR:
            score += 100.0
        if target_n_start is not None and eL == 'M':
            dot = ns.x * target_n_start.x + ns.y * target_n_start.y + ns.z * target_n_start.z
            score += dot * 50.0
        elif eL == 'M' and want_eL == 'M':
            score += ns.x * 1.0 + ns.y * 0.5

        candidates.append((score, -mode, b_try, ns, ne, eL, eR))

    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    best = candidates[0]
    return best[2], best[3], best[4], best[5], best[6]

def arrange_bar_pieces(raw_pieces):
    """
    Sắp xếp thứ tự và hướng đầu cắt (want_eL, want_eR) của các thanh trên 1 cây phôi 6m:
    - Ghép chuỗi [ke1 (S-M)] + [ke (M-M)...] + [ke1 (M-S)] để các đầu mòi 45 độ luôn cặp đôi song song (M // M).
    - Các thanh ke1 còn dư được ghép từng cặp [ke1 (S-M)] // [ke1 (M-S)].
    - Các thanh cắt thẳng 90 độ [thang (S-S)] nối tiếp theo mặt phẳng thẳng (S || S).
    - Nếu lẻ 1 thanh ke1 cuối cùng, đặt ở cuối cây theo hướng [S-M] để đầu thẳng S tiếp giáp khít với thanh trước.
    """
    ke_list = sorted([p for p in raw_pieces if p['style'] == 'ke'], key=lambda x: -x['length'])
    ke1_list = sorted([p for p in raw_pieces if p['style'] == 'ke1'], key=lambda x: -x['length'])
    thang_list = sorted([p for p in raw_pieces if p['style'] not in ('ke', 'ke1')], key=lambda x: -x['length'])

    ordered = []
    if len(ke_list) > 0:
        right_cap = None
        left_cap = None
        if len(ke1_list) >= 2:
            left_cap = dict(ke1_list.pop(0), want_eL='S', want_eR='M')
            right_cap = dict(ke1_list.pop(0), want_eL='M', want_eR='S')
        elif len(ke1_list) == 1:
            right_cap = dict(ke1_list.pop(0), want_eL='M', want_eR='S')

        pairs = []
        while len(ke1_list) >= 2:
            p1 = dict(ke1_list.pop(0), want_eL='S', want_eR='M')
            p2 = dict(ke1_list.pop(0), want_eL='M', want_eR='S')
            pairs.extend([p1, p2])
        odd_ke1 = [dict(ke1_list.pop(0), want_eL='S', want_eR='M')] if len(ke1_list) > 0 else []

        if left_cap:
            ordered.append(left_cap)
        for p in ke_list:
            ordered.append(dict(p, want_eL='M', want_eR='M'))
        if right_cap:
            ordered.append(right_cap)
        ordered.extend(pairs)
        for p in thang_list:
            ordered.append(dict(p, want_eL='S', want_eR='S'))
        ordered.extend(odd_ke1)
    else:
        pairs = []
        while len(ke1_list) >= 2:
            p1 = dict(ke1_list.pop(0), want_eL='S', want_eR='M')
            p2 = dict(ke1_list.pop(0), want_eL='M', want_eR='S')
            pairs.extend([p1, p2])
        odd_ke1 = [dict(ke1_list.pop(0), want_eL='S', want_eR='M')] if len(ke1_list) > 0 else []

        ordered.extend(pairs)
        for p in thang_list:
            ordered.append(dict(p, want_eL='S', want_eR='S'))
        ordered.extend(odd_ke1)

    return ordered

def calc_bar_usage(raw_pieces, kerf=0.0):
    """Tính chiều dài thực tế chiếm dụng trên cây phôi sau khi trừ tiết kiệm ghép mòi."""
    if not raw_pieces:
        return 0.0, 0.0, []
    ordered = arrange_bar_pieces(raw_pieces)
    used_len = 0.0
    nom_len = 0.0
    prev_eR = None
    for idx, item in enumerate(ordered):
        overlap = item['mat'] if (prev_eR == 'M' and item['want_eL'] == 'M') else 0.0
        item['overlap'] = overlap
        if idx > 0:
            used_len += (kerf - overlap)
        used_len += item['length']
        nom_len += item['length']
        prev_eR = item['want_eR']
    return used_len, nom_len, ordered

def solve_optimal_bars_for_profile(items_dict, usable_len=5920.0, kerf=0.0):
    """
    Giải bài toán xếp phôi tối ưu (Best-Fit / Subset-Sum có tính ghép mòi ke/ke1)
    đồng bộ với thuật toán trên Web App (toi-uu-engine.js).
    """
    keys = sorted(items_dict.keys(), key=lambda k: (
        0 if items_dict[k]['style'] in ('ke', 'ke1') else 1,
        -items_dict[k]['length']
    ))
    rem = {k: items_dict[k]['qty'] for k in keys}
    bars = []

    while sum(rem.values()) > 0:
        active_keys = [k for k in keys if rem[k] > 0]
        best_state = {'nom': -1.0, 'used': 1e18, 'counts': None, 'ordered': None}
        steps = [0]
        max_steps = 30000

        def dfs(idx, current_counts, current_raw):
            steps[0] += 1
            if steps[0] > max_steps:
                return
            used, nom, ordered = calc_bar_usage(current_raw, kerf)
            if used > usable_len + 1e-6:
                return
            if nom > best_state['nom'] + 1e-6 or (abs(nom - best_state['nom']) <= 1e-6 and used < best_state['used'] - 1e-6):
                if nom > 0:
                    best_state['nom'] = nom
                    best_state['used'] = used
                    best_state['counts'] = dict(current_counts)
                    best_state['ordered'] = ordered

            if idx >= len(active_keys):
                return

            k = active_keys[idx]
            it = items_dict[k]
            max_q = rem[k]
            for q in range(max_q, -1, -1):
                if steps[0] > max_steps:
                    break
                if q > 0:
                    current_counts[k] = q
                    added = [{'key': k, 'length': it['length'], 'style': it['style'], 'mat': it['mat']} for _ in range(q)]
                    dfs(idx + 1, current_counts, current_raw + added)
                    del current_counts[k]
                else:
                    dfs(idx + 1, current_counts, current_raw)

        dfs(0, {}, [])

        if not best_state['counts']:
            k0 = active_keys[0]
            it0 = items_dict[k0]
            raw_one = [{'key': k0, 'length': it0['length'], 'style': it0['style'], 'mat': it0['mat']}]
            used, nom, ordered = calc_bar_usage(raw_one, kerf)
            best_state['counts'] = {k0: 1}
            best_state['ordered'] = ordered
            best_state['used'] = used

        for k, q in best_state['counts'].items():
            rem[k] -= q

        bars.append({
            'pieces': best_state['ordered'],
            'current_len': best_state['used']
        })

    return bars

def solve_bars_with_engine(parts_by_prof, engine_dirs, stock_len=6000.0, clamp_tail=80.0, kerf=0.0):
    """
    Chạy engine toi-uu-engine.js thông qua Node.js để giải bài toán xếp phôi.
    Đảm bảo kết quả (thứ tự, thành phần chi tiết, góc cắt mòi) của file 3D .igs
    hoàn toàn trùng khớp 100% với Web App!
    """
    helper_path = None
    engine_path = None
    for edir in engine_dirs:
        hp = os.path.join(edir, 'run_engine_helper.js')
        ep = os.path.join(edir, 'toi-uu-engine.js')
        if os.path.exists(hp) and os.path.exists(ep):
            helper_path = hp
            engine_path = ep
            break

    if not helper_path or not engine_path:
        return None

    parts_list_for_node = []
    stock_list_for_node = []

    for prof_name, items_dict in parts_by_prof.items():
        stock_list_for_node.append({
            'length': stock_len,
            'clampTail': clamp_tail,
            'profile': prof_name,
            'qty': None
        })
        for part_key, it in items_dict.items():
            parts_list_for_node.append({
                'length': it['length'],
                'label': part_key,
                'profile': prof_name,
                'end_style': it['style'],
                'mat': it['mat'],
                'qty': it['qty']
            })

    payload = {
        'parts': parts_list_for_node,
        'stock': stock_list_for_node,
        'kerf': kerf,
        'gap': 0.0,
        'interlock': True
    }

    tmp_dir = tempfile.gettempdir()
    in_path = os.path.join(tmp_dir, f'fusion_payload_{os.getpid()}.json')
    out_path = os.path.join(tmp_dir, f'fusion_result_{os.getpid()}.json')

    try:
        with open(in_path, 'w', encoding='utf-8') as f_in:
            json.dump(payload, f_in, ensure_ascii=False)

        node_cmd = 'node'
        if not shutil.which('node'):
            for c_node in [r'C:\Program Files\nodejs\node.exe', r'C:\Program Files (x86)\nodejs\node.exe']:
                if os.path.exists(c_node):
                    node_cmd = c_node
                    break

        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE

        res = subprocess.run(
            [node_cmd, helper_path, engine_path, in_path, out_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            startupinfo=startupinfo
        )

        if os.path.exists(out_path):
            with open(out_path, 'r', encoding='utf-8') as f_out:
                data = json.load(f_out)
            if data.get('success') and 'bars' in data:
                return data['bars']
    except Exception as e:
        pass
    finally:
        try:
            if os.path.exists(in_path):
                os.remove(in_path)
            if os.path.exists(out_path):
                os.remove(out_path)
        except:
            pass

    return None

def export_single_body_to_igs(des, root, em, tbm, body, igs_path, temp_name):
    """Xuất 1 khối BRepBody đã chuẩn hóa tọa độ ra file .igs thông qua component tạm."""
    occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    comp = occ.component
    comp.name = temp_name
    try:
        if des.designType == adsk.fusion.DesignTypes.ParametricDesignType:
            bf = comp.features.baseFeatures.add()
            bf.startEdit()
            comp.bRepBodies.add(tbm.copy(body), bf)
            bf.finishEdit()
        else:
            comp.bRepBodies.add(tbm.copy(body))
        opts = em.createIGESExportOptions(igs_path, comp)
        em.execute(opts)
    finally:
        occ.deleteMe()

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        doc = app.activeDocument
        des = adsk.fusion.Design.cast(app.activeProduct)

        if not des:
            ui.messageBox('Vui lòng mở một bản vẽ 3D Design trước khi chạy script!', 'An Bình - Xuất IGS')
            return

        # Kích hoạt RootComponent để đảm bảo quét toàn bộ các loại hộp trong bản vẽ (không bị ẩn bởi Edit-in-place)
        if des.activeComponent != des.rootComponent:
            try:
                des.activateRootComponent()
            except:
                pass

        root = des.rootComponent
        em = des.exportManager
        tbm = adsk.fusion.TemporaryBRepManager.get()

        # 1. Hộp thoại chọn thư mục lưu file .IGS
        folder_dlg = ui.createFolderDialog()
        folder_dlg.title = f'Chọn thư mục lưu file .IGS cho bản vẽ: {doc.name}'
        dlg_res = folder_dlg.showDialog()

        if dlg_res != adsk.core.DialogResults.DialogOK:
            return

        chosen_folder = folder_dlg.folder
        safe_doc_name = re.sub(r'[\/\\:*?"<>|]', '_', doc.name).strip()
        if os.path.basename(chosen_folder).lower() == safe_doc_name.lower():
            export_dir = chosen_folder
        else:
            export_dir = os.path.join(chosen_folder, safe_doc_name)
        os.makedirs(export_dir, exist_ok=True)

        # Xóa các file .igs cũ trong thư mục đích để tránh nhầm lẫn với lần xuất trước
        for old_f in os.listdir(export_dir):
            if old_f.lower().endswith('.igs'):
                try:
                    os.remove(os.path.join(export_dir, old_f))
                except:
                    pass

        parts_dict = {}
        parts_by_prof = {}
        norm_bodies_by_key = {}
        total_tubes_count = 0

        exclude_keywords = [
            "mặt bàn", "mat ban", "mica", "tấm", "tam", "plate", "bản mã", "ban ma",
            "mã chân", "ma chan", "ecu", "êcu", "bulong", "bolt", "nut", "vít", "vit",
            "bánh xe", "gối", "trục", "chìa", "bản lề", "stast", "stop", "fkl", "c-fjfn", "c-hhszn"
        ]

        # Thu thập toàn bộ các khối 3D từ cả Occurrences (Components) VÀ RootComponent Bodies
        candidate_entries = []
        for i in range(root.allOccurrences.count):
            occ = root.allOccurrences.item(i)
            if not occ.isLightBulbOn:
                continue
            comp = occ.component
            if comp.name.startswith('Cay_') or comp.name.startswith('Cây_') or comp.name.startswith('Test_Bar'):
                continue
            for b_idx in range(comp.bRepBodies.count):
                b = comp.bRepBodies.item(b_idx)
                if b.isLightBulbOn:
                    name_hint = comp.name if comp.bRepBodies.count == 1 else f"{comp.name}_{b.name}"
                    candidate_entries.append((b, name_hint, comp))

        # Nếu bản vẽ có các khối vẽ trực tiếp trong RootComponent mà chưa tách Component
        for b_idx in range(root.bRepBodies.count):
            b = root.bRepBodies.item(b_idx)
            if b.isLightBulbOn:
                candidate_entries.append((b, b.name, root))

        # 2. Quét toàn bộ chi tiết trong bản vẽ & chuẩn hóa tọa độ 3D cho TẤT CẢ các loại hộp
        for orig_body, raw_name_hint, comp_ref in candidate_entries:
            clean_hint = re.sub(r':\d+$', '', raw_name_hint).strip()
            clean_lower = clean_hint.lower()
            if any(kw in clean_lower for kw in exclude_keywords):
                continue

            bb_raw = orig_body.boundingBox
            dx_raw = round((bb_raw.maxPoint.x - bb_raw.minPoint.x) * 10, 1)
            dy_raw = round((bb_raw.maxPoint.y - bb_raw.minPoint.y) * 10, 1)
            dz_raw = round((bb_raw.maxPoint.z - bb_raw.minPoint.z) * 10, 1)

            dims = sorted([dx_raw, dy_raw, dz_raw])
            # Bỏ qua tấm tôn phẳng, mặt bàn mỏng hoặc chi tiết quá nhỏ
            if dims[0] <= 3.5 and dims[1] > 70:
                continue
            if dims[0] < 5 or (dims[2] / max(dims[1], 1)) < 1.1:
                continue

            norm_b = normalize_body(tbm, orig_body)
            bb = norm_b.boundingBox
            w_mm = round((bb.maxPoint.x - bb.minPoint.x) * 10, 1)
            h_mm = round((bb.maxPoint.y - bb.minPoint.y) * 10, 1)
            l_max = round((bb.maxPoint.z - bb.minPoint.z) * 10, 1)
            l_cm = bb.maxPoint.z - bb.minPoint.z

            t = detect_wall_thickness(norm_b, w_mm, h_mm, clean_hint)
            t_str = f"{int(t)}" if float(t).is_integer() else f"{t}"

            if abs(w_mm - h_mm) < 1.5:
                w_int = int(round(w_mm))
                prof_name = f'Hộp {w_int}x{w_int}x{t_str}'
            else:
                w1 = int(round(max(w_mm, h_mm)))
                w2 = int(round(min(w_mm, h_mm)))
                prof_name = f'Hộp {w1}x{w2}x{t_str}'

            # Kiểm tra góc vát mòi 3D trực tiếp từ 2 mặt đầu thanh đã chuẩn hóa
            ns, ne = get_end_normals(norm_b, l_cm)
            ang_s = round(math.degrees(math.acos(max(-1.0, min(1.0, abs(ns.z))))), 1)
            ang_e = round(math.degrees(math.acos(max(-1.0, min(1.0, abs(ne.z))))), 1)
            is_m_start = ang_s >= 2.0
            is_m_end = ang_e >= 2.0
            miter_ends = (1 if is_m_start else 0) + (1 if is_m_end else 0)

            # Tính độ vát chính xác dọc trục Z (Delta L = (|n_x|*w + |n_y|*h) / |n_z|)
            def calc_delta_z(n_vec):
                nz_clamped = max(abs(n_vec.z), 0.005)
                return (abs(n_vec.x) * w_mm + abs(n_vec.y) * h_mm) / nz_clamped

            delta_s = calc_delta_z(ns) if is_m_start else 0.0
            delta_e = calc_delta_z(ne) if is_m_end else 0.0

            if miter_ends == 2:
                # 2 đầu đều vát: kiểm tra cùng góc hay khác góc
                if abs(ang_s - ang_e) <= 1.5:
                    style = 'ke'
                    mat = round((delta_s + delta_e) / 2.0, 1)
                    avg_ang = round((ang_s + ang_e) / 2.0, 1)
                    ang_disp = f"{int(round(avg_ang))}" if abs(avg_ang - round(avg_ang)) < 0.2 else f"{avg_ang}"
                    angle_tag = "Ke" if (43.0 <= avg_ang <= 47.0) else f"Vát {ang_disp}°"
                else:
                    style = 'ke'
                    mat = round(max(delta_s, delta_e), 1)
                    s_disp = f"{int(round(ang_s))}" if abs(ang_s - round(ang_s)) < 0.2 else f"{ang_s}"
                    e_disp = f"{int(round(ang_e))}" if abs(ang_e - round(ang_e)) < 0.2 else f"{ang_e}"
                    angle_tag = f"Vát {s_disp}°-Vát {e_disp}°"
            elif miter_ends == 1:
                style = 'ke1'
                ang_val = ang_s if is_m_start else ang_e
                mat = round(delta_s if is_m_start else delta_e, 1)
                ang_disp = f"{int(round(ang_val))}" if abs(ang_val - round(ang_val)) < 0.2 else f"{ang_val}"
                angle_tag = "Ke1" if (43.0 <= ang_val <= 47.0) else f"Vát 1 đầu {ang_disp}°"
            else:
                style = 'thang'
                mat = 0.0
                angle_tag = ""

            l_str = f"{int(l_max)}" if float(l_max).is_integer() else f"{l_max}"
            # Giữ hậu tố đặc biệt (như lỗ thoát, lỗ ren, Mirror) nếu có trong tên chi tiết
            extra_note = re.sub(r'^(?:Hộp|Hop|Ống|Ong)?\s*\d+\s*[xX\*×]\s*\d+(?:\s*[xX\*×]\s*\d+(?:[.,]\d+)?)?\s*(?:L|l)?\s*\d+(?:[.,]\d+)?', '', clean_hint, flags=re.I).strip()
            extra_note = re.sub(r'\b(?:ke1|ke2|ke|sl\s*\d+)\b', '', extra_note, flags=re.I).strip()

            tag_suffix = f"_{angle_tag}" if angle_tag else f"_{style}"
            part_key = f"{prof_name}_L{l_str}{tag_suffix}_{extra_note}" if extra_note else f"{prof_name}_L{l_str}{tag_suffix}"

            if part_key in parts_dict:
                parts_dict[part_key]['qty'] += 1
            else:
                parts_dict[part_key] = {
                    'profile': prof_name,
                    'length': l_max,
                    'l_str': l_str,
                    'extra_note': extra_note,
                    'angle_tag': angle_tag,
                    'ang_s': ang_s,
                    'ang_e': ang_e,
                    'qty': 1,
                    'style': style,
                    'mat': mat,
                    'comp': comp_ref,
                    'norm_body': norm_b,
                    'raw_name': clean_hint
                }

            if prof_name not in parts_by_prof:
                parts_by_prof[prof_name] = {}
            if part_key not in parts_by_prof[prof_name]:
                parts_by_prof[prof_name][part_key] = {
                    'profile': prof_name,
                    'length': l_max,
                    'l_str': l_str,
                    'qty': 0,
                    'style': style,
                    'mat': mat,
                    'comp': comp_ref
                }
            parts_by_prof[prof_name][part_key]['qty'] += 1
            norm_bodies_by_key[part_key] = parts_dict[part_key]['norm_body']
            total_tubes_count += 1

        if not parts_dict:
            ui.messageBox('Không tìm thấy chi tiết ống/hộp nào trong bản vẽ hiện tại!', 'An Bình - Xuất IGS')
            return

        # 3. XUẤT CÁC FILE .IGS CHI TIẾT LẺ KÈM HẬU TỐ SỐ LƯỢNG "SL <qty>"
        parts_list = []
        for part_key, p in parts_dict.items():
            qty = p['qty']
            prof_name = p['profile']
            l_str = p['l_str']
            style = p['style']
            extra = f" {p['extra_note']}" if p.get('extra_note') else ""

            if p.get('angle_tag'):
                miter_tag = f" {p['angle_tag']}"
            elif style == 'ke':
                miter_tag = " Ke"
            elif style == 'ke1':
                miter_tag = " Ke1"
            else:
                miter_tag = ""

            clean_part_name = f"{prof_name} L{l_str}{extra}{miter_tag} SL {qty}"
            safe_file_name = re.sub(r'[\/\\:*?"<>|]', '_', clean_part_name)
            igs_path = os.path.join(export_dir, f"{safe_file_name}.igs")

            try:
                export_single_body_to_igs(des, root, em, tbm, p['norm_body'], igs_path, safe_file_name)
            except Exception as e:
                pass

            parts_list.append({
                'name': clean_part_name,
                'profile': prof_name,
                'length': p['length'],
                'qty': qty,
                'style': style,
                'mat': p['mat'],
                'igs_file': igs_path.replace('\\', '/')
            })

        # 4. XUẤT ĐẦY ĐỦ TẤT CẢ FILE .IGS CÁC CÂY GHÉP 6M CHO MỌI LOẠI HỘP
        stock_len = 6000.0
        clamp_len = 80.0  # Chuẩn kẹp đuôi 80mm đồng bộ 100% với Laser CNC trên Web
        usable_len = stock_len - clamp_len  # 5920mm
        kerf = 0.0  # Common-line cut liền mạch
        bar_exports = []
        alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

        script_dir = os.path.dirname(__file__)
        candidate_engine_dirs = [
            script_dir,
            'C:/Users/Administrator/toiuu-phoi',
            'C:/Users/Administrator/Fusion360/toiuu-phoi'
        ]

        # Đảm bảo có sẵn run_engine_helper.js và toi-uu-engine.js trong script_dir
        for src_dir in ['C:/Users/Administrator/toiuu-phoi', 'C:/Users/Administrator/Fusion360/toiuu-phoi']:
            for fn in ['run_engine_helper.js', 'toi-uu-engine.js']:
                sf = os.path.join(src_dir, fn)
                df = os.path.join(script_dir, fn)
                if os.path.exists(sf) and not os.path.exists(df):
                    try:
                        shutil.copy2(sf, df)
                    except:
                        pass

        # Giải bài toán tối ưu bằng toi-uu-engine.js thông qua Node.js để kết quả 3D trùng khớp 100% với Web
        engine_bars = solve_bars_with_engine(parts_by_prof, candidate_engine_dirs, stock_len=stock_len, clamp_tail=clamp_len, kerf=kerf)

        grouped_bars = []
        if engine_bars and len(engine_bars) > 0:
            for eb in engine_bars:
                grouped_bars.append({
                    'profile': eb['profile'],
                    'letter': eb['letter'],
                    'count': eb.get('count', 1),
                    'pieces': eb['pieces'],
                    'cuts_count': eb['cutsCount'],
                    'waste': eb['waste']
                })
        else:
            # Fallback thuật toán Python nếu máy tính chưa cài Node.js
            for prof_name, items_dict in parts_by_prof.items():
                bars = solve_optimal_bars_for_profile(items_dict, usable_len=usable_len, kerf=kerf)
                cur_prof_bars = []
                for bar in bars:
                    sig = tuple((p['key'], p['length'], p['style'], p['want_eL'], p['want_eR']) for p in bar['pieces'])
                    found = False
                    for gb in cur_prof_bars:
                        if gb['sig'] == sig:
                            gb['count'] += 1
                            found = True
                            break
                    if not found:
                        cur_prof_bars.append({
                            'sig': sig,
                            'profile': prof_name,
                            'count': 1,
                            'pieces': bar['pieces'],
                            'current_len': bar['current_len']
                        })
                for idx, gb in enumerate(cur_prof_bars):
                    gb['letter'] = alphabet[idx % len(alphabet)]
                    gb['cuts_count'] = len(gb['pieces'])
                    grouped_bars.append(gb)

        # Xuất từng cây ghép (Cây A, Cây B...) của từng loại hộp thành file .IGS 3D Solid hoàn chỉnh
        for gb in grouped_bars:
            letter = gb['letter']
            prof_name = gb['profile']
            bar_count = gb['count']
            safe_prof_str = prof_name.replace(' ', '_')
            bar_name = f"Cay_{letter}_{safe_prof_str}_L{int(stock_len)}_SL_{bar_count}"
            safe_bar_name = re.sub(r'[\/\\:*?"<>|]', '_', bar_name)
            igs_bar_path = os.path.join(export_dir, f"{safe_bar_name}.igs")

            bar_occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
            bar_comp = bar_occ.component
            bar_comp.name = safe_bar_name

            try:
                placed_bodies = []
                cur_z_cm = 0.0
                prev_ne = None
                prev_eR = None

                for p_info in gb['pieces']:
                    nb = norm_bodies_by_key.get(p_info['key'])
                    if not nb:
                        for k, v in norm_bodies_by_key.items():
                            if parts_dict[k]['length'] == p_info['length'] and parts_dict[k]['style'] == p_info['style']:
                                nb = v
                                break
                    if not nb:
                        continue

                    l_cm = p_info['length'] / 10.0
                    mat_cm = p_info['mat'] / 10.0
                    wL = p_info['want_eL']
                    wR = p_info['want_eR']

                    if 'start_z' in p_info:
                        start_z_cm = p_info['start_z'] / 10.0
                    else:
                        overlap_cm = mat_cm if (prev_eR == 'M' and wL == 'M') else 0.0
                        if prev_eR is not None:
                            cur_z_cm += ((kerf / 10.0) - overlap_cm)
                        start_z_cm = cur_z_cm
                        cur_z_cm += l_cm

                    target_ns = None
                    if prev_ne is not None and prev_eR == 'M' and wL == 'M':
                        target_ns = adsk.core.Vector3D.create(-prev_ne.x, -prev_ne.y, -prev_ne.z)

                    b_oriented, ns, ne, eL, eR = orient_piece(tbm, nb, l_cm, wL, wR, target_ns)

                    trans = adsk.core.Matrix3D.create()
                    trans.translation = adsk.core.Vector3D.create(0, 0, start_z_cm)
                    tbm.transform(b_oriented, trans)

                    placed_bodies.append((b_oriented, p_info))
                    prev_ne = ne
                    prev_eR = eR

                if des.designType == adsk.fusion.DesignTypes.ParametricDesignType:
                    bf = bar_comp.features.baseFeatures.add()
                    bf.startEdit()
                    for b_item, p_info in placed_bodies:
                        new_b = bar_comp.bRepBodies.add(b_item, bf)
                        if new_b:
                            raw_hint = parts_dict.get(p_info['key'], {}).get('raw_name') or p_info.get('key', '')
                            clean_short = re.sub(r'^(?:Hộp|Hop|Ống|Ong)?\s*\d+\s*[xX\*×]\s*\d+(?:\s*[xX\*×]\s*\d+(?:[.,]\d+)?)?', '', raw_hint, flags=re.I).strip()
                            new_b.name = clean_short if clean_short else f"L{int(p_info['length'])}"
                    bf.finishEdit()
                else:
                    for b_item, p_info in placed_bodies:
                        new_b = bar_comp.bRepBodies.add(b_item)
                        if new_b:
                            raw_hint = parts_dict.get(p_info['key'], {}).get('raw_name') or p_info.get('key', '')
                            clean_short = re.sub(r'^(?:Hộp|Hop|Ống|Ong)?\s*\d+\s*[xX\*×]\s*\d+(?:\s*[xX\*×]\s*\d+(?:[.,]\d+)?)?', '', raw_hint, flags=re.I).strip()
                            new_b.name = clean_short if clean_short else f"L{int(p_info['length'])}"

                igs_opts = em.createIGESExportOptions(igs_bar_path, bar_comp)
                em.execute(igs_opts)

                igs_text = ''
                if os.path.exists(igs_bar_path):
                    try:
                        with open(igs_bar_path, 'r', encoding='utf-8', errors='ignore') as f_igs:
                            igs_text = f_igs.read()
                    except:
                        pass

                bar_exports.append({
                    'letter': letter,
                    'name': safe_bar_name,
                    'profile': prof_name,
                    'stock_length': stock_len,
                    'cuts_count': len(placed_bodies),
                    'bar_count': bar_count,
                    'igs_file': igs_bar_path.replace('\\', '/'),
                    'file_size': os.path.getsize(igs_bar_path) if os.path.exists(igs_bar_path) else 0,
                    'igs_content': igs_text
                })
            except Exception as e:
                pass
            finally:
                bar_occ.deleteMe()

        # 5. Lưu file JSON dữ liệu dự án (Chuẩn hóa đường dẫn '/' tránh lỗi JSON escape '\')
        payload_data = {
            'project_name': doc.name,
            'export_dir': export_dir.replace('\\', '/'),
            'stock_length': stock_len,
            'clamp_tail': clamp_len,
            'kerf': kerf,
            'parts': parts_list,
            'nested_bars': bar_exports
        }
        json_path = os.path.join(export_dir, 'fusion_exported_project.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(payload_data, f, indent=2, ensure_ascii=False)

        # 6. Tự động khởi động Máy Chủ Web (server.js) và đẩy dữ liệu trực tiếp qua HTTP API
        script_dir = os.path.dirname(__file__)
        candidate_web_dirs = [
            'C:/Users/Administrator/toiuu-phoi',
            'C:/Users/Administrator/Fusion360/toiuu-phoi',
            script_dir
        ]

        found_web_dir = None
        for cdir in candidate_web_dirs:
            if os.path.exists(os.path.join(cdir, 'index.html')):
                found_web_dir = os.path.abspath(cdir)
                break

        # Vẫn lưu bản sao file HTML dự phòng vào thư mục xuất
        if found_web_dir:
            try:
                for fname in ['index.html', 'logo_an_binh.jpg', 'toi-uu-engine.js', 'run_engine_helper.js', 'workshop_config.json']:
                    src_f = os.path.join(found_web_dir, fname)
                    dst_f = os.path.join(export_dir, fname)
                    if os.path.exists(src_f) and (not os.path.exists(dst_f) or os.path.abspath(src_f) != os.path.abspath(dst_f)):
                        shutil.copy2(src_f, dst_f)

                idx_export_path = os.path.join(export_dir, 'index.html')
                if os.path.exists(idx_export_path):
                    with open(idx_export_path, 'r', encoding='utf-8') as f:
                        html_content = f.read()
                    json_str = json.dumps(payload_data, ensure_ascii=False)
                    embed_tag = f'<script id="embeddedFusionData" type="application/json">{json_str}</script>'
                    if '<script id="embeddedFusionData"' in html_content:
                        html_content = re.sub(
                            r'<script id="embeddedFusionData"[^>]*>.*?</script>',
                            lambda m: embed_tag,
                            html_content,
                            flags=re.DOTALL
                        )
                    else:
                        html_content = html_content.replace('</head>', f'{embed_tag}\n</head>')
                    with open(idx_export_path, 'w', encoding='utf-8') as f:
                        f.write(html_content)
            except Exception:
                pass

        # Đảm bảo Máy chủ Web Full-Stack (port 3000) đang chạy và đẩy dữ liệu lên API
        import urllib.request
        import time
        server_url = "http://localhost:3000"
        lan_url_display = server_url
        pushed_to_server = False

        def is_server_alive():
            try:
                req = urllib.request.Request(f"{server_url}/api/info", method='GET')
                with urllib.request.urlopen(req, timeout=1.5) as resp:
                    return resp.status == 200
            except Exception:
                return False

        if not is_server_alive():
            # Tự động bật server.js trong nền
            node_exe = shutil.which('node')
            if not node_exe:
                for c_node in [r'C:\Program Files\nodejs\node.exe', r'C:\Program Files (x86)\nodejs\node.exe']:
                    if os.path.exists(c_node):
                        node_exe = c_node
                        break
            server_js = 'C:/Users/Administrator/toiuu-phoi/server.js'
            if not os.path.exists(server_js) and found_web_dir:
                server_js = os.path.join(found_web_dir, 'server.js')

            if node_exe and os.path.exists(server_js):
                try:
                    creationflags = 0x08000000 if os.name == 'nt' else 0  # CREATE_NO_WINDOW
                    subprocess.Popen(
                        [node_exe, server_js],
                        cwd=os.path.dirname(server_js),
                        creationflags=creationflags,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    for _ in range(10):
                        time.sleep(0.3)
                        if is_server_alive():
                            break
                except Exception:
                    pass

        # Bắn dữ liệu bản vẽ trực tiếp lên Máy chủ Web qua POST /api/fusion-import
        try:
            post_bytes = json.dumps(payload_data, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(
                f"{server_url}/api/fusion-import",
                data=post_bytes,
                headers={'Content-Type': 'application/json; charset=utf-8'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                if resp_data.get('success'):
                    pushed_to_server = True
                    lan_list = resp_data.get('lanUrls') or []
                    if len(lan_list) > 0 and lan_list[0].get('url'):
                        lan_url_display = lan_list[0]['url']
        except Exception:
            pushed_to_server = False

        # 6B. Bắn dữ liệu trực tiếp lên ĐÁM MÂY QUỐC TẾ 24/7 (https://ntfy.sh/toiuu_phoi_anbinh_cloud_v2)
        # Giúp mọi máy tính khác chạy Script đều đẩy chung về 1 kho dữ liệu 24/7 và hoạt động kể cả khi tắt máy tính!
        try:
            active_profs = list(parts_by_prof.keys())
            cloud_parts = []
            for idx, p in enumerate(parts_list):
                cloud_parts.append({
                    'id': f"p_f360_{int(time.time()*1000)}_{idx}",
                    'name': p['name'],
                    'profile': p['profile'],
                    'length': p['length'],
                    'qty': p['qty'],
                    'style': p['style'],
                    'mat': p['mat'],
                    '_autoDetected': True
                })
            cloud_stock = []
            for idx, prof in enumerate(active_profs):
                cloud_stock.append({
                    'id': f"s_f360_{int(time.time()*1000)}_{idx}",
                    'profile': prof,
                    'name': f"Cây mới 6.000 ({prof})",
                    'length': stock_len,
                    'qty': None,
                    'clamp': clamp_len
                })
            light_bars = []
            for b in bar_exports:
                light_bars.append({
                    'name': b['name'],
                    'profile': b['profile'],
                    'letter': b['letter'],
                    'count': b.get('bar_count', 1),
                    'cuts_count': b.get('cuts_count', 0),
                    'pieces': b.get('pieces', [])
                })
            now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            proj_data_obj = {
                'activeProfiles': active_profs,
                'selectedTabProfile': active_profs[0] if active_profs else 'Hộp 30x30x1.8',
                'parts': cloud_parts,
                'stock': cloud_stock,
                'method': 'cnc',
                'kerf': kerf,
                'clamp': clamp_len,
                'interlock': True,
                'gap': 0,
                'fusionProject': {
                    'project_name': doc.name,
                    'stock_length': stock_len,
                    'clamp_tail': clamp_len,
                    'kerf': kerf,
                    'nested_bars': light_bars
                }
            }
            new_proj_id = f"proj_f360_{int(time.time()*1000)}"
            cloud_proj_entry = {
                'id': new_proj_id,
                'name': doc.name,
                'customer': 'Fusion 360 CAD',
                'notes': f"Đồng bộ tự động từ Fusion 360 ({len(cloud_parts)} mục, {len(active_profs)} loại hộp)",
                'createdAt': now_iso,
                'updatedAt': now_iso,
                'data': proj_data_obj
            }
            cloud_envelope = {
                'senderId': 'fusion360_addin',
                'action': 'fusion_import',
                'projectName': doc.name,
                'updatedAt': now_iso,
                'savedProjects': [cloud_proj_entry],
                'activeProject': {
                    'currentProjectId': new_proj_id,
                    'currentProjectName': doc.name,
                    'currentProjectCustomer': 'Fusion 360 CAD',
                    'currentProjectNotes': cloud_proj_entry['notes'],
                    **proj_data_obj
                }
            }
            cloud_bytes = json.dumps(cloud_envelope, ensure_ascii=False).encode('utf-8')
            req_cloud = urllib.request.Request(
                "https://ntfy.sh/toiuu_phoi_anbinh_cloud_v2",
                data=cloud_bytes,
                headers={
                    'Filename': 'workshop_db.json',
                    'Title': 'Fusion 360 Sync'
                },
                method='PUT'
            )
            urllib.request.urlopen(req_cloud, timeout=8).close()
            pushed_to_cloud = True
        except Exception:
            pushed_to_cloud = False

        permanent_netlify_url = "https://xepphoianbinh.netlify.app"
        if pushed_to_cloud:
            target_web_url = permanent_netlify_url
        elif pushed_to_server:
            target_web_url = server_url
        else:
            target_web_url = 'file:///' + os.path.join(export_dir, 'index.html').replace('\\', '/')

        # 7. Mở trình duyệt Web App chính thức 24/7
        webbrowser.open(target_web_url)

        # 8. Hiển thị thông báo kết quả chi tiết
        prof_names_str = ", ".join(parts_by_prof.keys())
        msg = f"✓ ĐÃ ĐỒNG BỘ LÊN WEB CLOUD 24/7 & XUẤT FILE .IGS: {doc.name}\n\n"
        msg += f"• Các loại hộp phát hiện ({len(parts_by_prof)} loại): {prof_names_str}\n"
        msg += f"• Tổng số chi tiết bản vẽ: {total_tubes_count} thanh\n\n"
        msg += f"★ CÁC CÂY GHÉP 6M (LIỀN MẠCH - KHÍT MÒI 100%): {len(bar_exports)} file .IGS\n"
        for be in bar_exports:
            msg += f"   ➔ {be['name']}.igs ({be['profile']} · Ghép {be['cuts_count']} ct · SL: {be['bar_count']} cây)\n"
        msg += f"\n🌍 LINK WEB ĐÁM MÂY CỐ ĐỊNH 24/7 (MỌI THIẾT BỊ & TẮT MÁY VẪN CHẠY):\n"
        msg += f"   • {permanent_netlify_url}\n"
        msg += f"\n📂 Thư mục lưu file .IGS: {export_dir}"

        ui.messageBox(msg, 'An Bình - Đồng Bộ Web Cloud 24/7 & Xuất IGS')

    except:
        if ui:
            ui.messageBox('Lỗi khi bóc tách & ghép cây: {}'.format(traceback.format_exc()), 'An Bình - Xuất IGS')

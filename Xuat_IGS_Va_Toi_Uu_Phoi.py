try:
    import adsk.core, adsk.fusion
except ImportError:
    adsk = None

_CoreInputChangedBase = getattr(getattr(adsk, 'core', None), 'InputChangedEventHandler', object)
_CoreValidateInputsBase = getattr(getattr(adsk, 'core', None), 'ValidateInputsEventHandler', object)
_CoreCommandEventBase = getattr(getattr(adsk, 'core', None), 'CommandEventHandler', object)
_CoreCommandCreatedBase = getattr(getattr(adsk, 'core', None), 'CommandCreatedEventHandler', object)
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

    m_round = re.search(r'(?:Ø|Phi|phi|D|d)\s*\d+(?:[.,]\d+)?\s*[xX\*×]\s*(\d+(?:[.,]\d+)?)', name_hint)
    if m_round:
        val = float(m_round.group(1).replace(',', '.'))
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
    """Xuất 1 khối BRepBody đã chuẩn hóa tọa độ ra file .igs thông qua component tạm được cô lập sạch."""
    occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    try:
        occ.isLightBulbOn = True
    except Exception:
        pass
    comp = occ.component
    comp.name = temp_name
    try:
        try:
            comp.isBodiesFolderLightBulbOn = True
        except Exception:
            pass
        if des.designType == adsk.fusion.DesignTypes.ParametricDesignType:
            bf = comp.features.baseFeatures.add()
            bf.startEdit()
            added_b = comp.bRepBodies.add(tbm.copy(body), bf)
            bf.finishEdit()
        else:
            added_b = comp.bRepBodies.add(tbm.copy(body))
        if added_b is not None:
            try:
                added_b.isLightBulbOn = True
            except Exception:
                pass
        opts = em.createIGESExportOptions(igs_path, comp)
        em.execute(opts)
    finally:
        occ.deleteMe()


# ============================================================================
# CHỌN PHẠM VI COMPONENT, CHỐNG TRÙNG LẶP, CÔ LẬP HIỂN THỊ & HỘP THOẠI LỆNH
# ============================================================================
CMD_ID = 'AnBinh_XuatIGS_ToiUuPhoi_Cmd'
_handlers = []
_session = {}

EXCLUDE_KEYWORDS = [
    "mặt bàn", "mat ban", "mica", "tấm", "tam", "plate", "bản mã", "ban ma",
    "mã chân", "ma chan", "ecu", "êcu", "bulong", "bu lông", "bu-lông", "bolt",
    "nut", "ốc", "oc vit", "vít", "vit", "screw", "rivet", "đinh tán", "long đen",
    "long den", "washer", "bánh xe", "banh xe", "caster", "wheel", "gối", "trục",
    "chìa", "bản lề", "ban le", "hinge", "nắp bịt", "nap bit", "nút bịt", "bịt đầu",
    "chân tăng", "chan tang", "cao su", "gân tăng cứng", "ke góc", "ke goc",
    "tay nắm", "tay nam", "khóa", "đệm", "sheet metal", "flange", "bracket",
    "bearing", "vòng bi", "bạc đạn", "stast", "stop", "fkl", "c-fjfn", "c-hhszn"
]


def clean_instance_name(name):
    return re.sub(r':\d+$', '', str(name or '')).strip()


def get_occ_full_path(occ):
    try:
        fp = getattr(occ, 'fullPathName', '') or ''
        if fp:
            return fp
    except Exception:
        pass
    try:
        return str(getattr(occ, 'name', '') or id(occ))
    except Exception:
        return str(id(occ))


def is_temp_export_component_name(name):
    s = str(name or '')
    return s.startswith('Cay_') or s.startswith('Cây_') or s.startswith('Test_Bar')


def is_occ_suppressed_hierarchy(occ):
    cur = occ
    visited = set()
    while cur is not None and id(cur) not in visited:
        visited.add(id(cur))
        try:
            if getattr(cur, 'isSuppressed', False):
                return True
        except Exception:
            pass
        try:
            tl = getattr(cur, 'timelineObject', None)
            if tl is not None and getattr(tl, 'isSuppressed', False):
                return True
        except Exception:
            pass
        try:
            cur = getattr(cur, 'assemblyContext', None)
        except Exception:
            cur = None
    return False


def is_occ_visible_hierarchy(occ):
    cur = occ
    visited = set()
    while cur is not None and id(cur) not in visited:
        visited.add(id(cur))
        try:
            if not getattr(cur, 'isLightBulbOn', True):
                return False
        except Exception:
            pass
        try:
            if hasattr(cur, 'isVisible') and not cur.isVisible:
                return False
        except Exception:
            pass
        try:
            cur = getattr(cur, 'assemblyContext', None)
        except Exception:
            cur = None
    return True


def is_body_visible_hierarchy(proxy_body, local_body, comp, occ=None):
    if occ is not None and not is_occ_visible_hierarchy(occ):
        return False
    try:
        if comp is not None and not getattr(comp, 'isBodiesFolderLightBulbOn', True):
            return False
    except Exception:
        pass
    for b_ref in (proxy_body, local_body):
        if b_ref is None:
            continue
        try:
            if not getattr(b_ref, 'isLightBulbOn', True):
                return False
        except Exception:
            pass
        try:
            if hasattr(b_ref, 'isVisible') and not b_ref.isVisible:
                return False
        except Exception:
            pass
    return True


def _cast_entity(cls_obj, ent):
    if cls_obj is None or not hasattr(cls_obj, 'cast'):
        return None
    try:
        return cls_obj.cast(ent)
    except Exception:
        return None


def resolve_preselected_occurrences(ui, root, des=None):
    """Đọc các đối tượng người dùng chọn sẵn trước khi chạy script (Occurrence, Body, Face, Edge hoặc Sub-assembly đang kích hoạt)."""
    occs = []
    seen = set()

    def add_occ(occ):
        if occ is None:
            return
        fp = get_occ_full_path(occ)
        if fp not in seen:
            seen.add(fp)
            occs.append(occ)

    try:
        sels = getattr(ui, 'activeSelections', None)
        sel_count = sels.count if sels is not None else 0
        for idx in range(sel_count):
            ent = getattr(sels.item(idx), 'entity', None)
            if ent is None:
                continue

            occ = _cast_entity(getattr(adsk.fusion, 'Occurrence', None), ent)
            if occ is not None:
                add_occ(occ)
                continue

            body = _cast_entity(getattr(adsk.fusion, 'BRepBody', None), ent)
            if body is not None:
                ctx_occ = getattr(body, 'assemblyContext', None)
                if ctx_occ is not None:
                    add_occ(ctx_occ)
                continue

            face = _cast_entity(getattr(adsk.fusion, 'BRepFace', None), ent)
            if face is not None and getattr(face, 'body', None) is not None:
                ctx_occ = getattr(face.body, 'assemblyContext', None)
                if ctx_occ is not None:
                    add_occ(ctx_occ)
                continue

            edge = _cast_entity(getattr(adsk.fusion, 'BRepEdge', None), ent)
            if edge is not None and getattr(edge, 'body', None) is not None:
                ctx_occ = getattr(edge.body, 'assemblyContext', None)
                if ctx_occ is not None:
                    add_occ(ctx_occ)
                continue

            comp = _cast_entity(getattr(adsk.fusion, 'Component', None), ent)
            if comp is not None and comp != root and hasattr(root, 'allOccurrences'):
                all_occs = root.allOccurrences
                for j in range(all_occs.count):
                    cand = all_occs.item(j)
                    if getattr(cand, 'component', None) == comp:
                        add_occ(cand)
    except Exception:
        pass

    if not occs and des is not None:
        try:
            act_occ = getattr(des, 'activeOccurrence', None)
            if act_occ is not None:
                add_occ(act_occ)
        except Exception:
            pass

    return occs


def suggest_project_name(selected_occs, doc_name, use_root_mode=False):
    """Tự gợi ý tên dự án theo Component mẹ đang chọn (hoặc tên file gốc nếu xuất Root)."""
    base_doc = str(doc_name or 'DuAn_Fusion360').strip()
    if use_root_mode or not selected_occs:
        return base_doc
    if len(selected_occs) == 1:
        occ = selected_occs[0]
        comp = getattr(occ, 'component', None)
        candidate = clean_instance_name(getattr(occ, 'name', '') or (getattr(comp, 'name', '') if comp else ''))
        return candidate or base_doc

    # Nếu chọn nhiều ống/cụm con cùng nằm chung 1 Component mẹ trực tiếp -> lấy tên cụm mẹ đó
    try:
        parent_paths = set()
        parents = []
        for occ in selected_occs:
            p_occ = getattr(occ, 'assemblyContext', None)
            if p_occ is None:
                parent_paths.clear()
                break
            fp = get_occ_full_path(p_occ)
            parent_paths.add(fp)
            parents.append(p_occ)
        if len(parent_paths) == 1 and parents:
            p_name = clean_instance_name(getattr(parents[0], 'name', ''))
            if p_name:
                return p_name
    except Exception:
        pass

    return f"{base_doc} ({len(selected_occs)} cụm chọn)"


def collect_scoped_candidates(root, selected_occs, use_root_mode=False, skip_hidden=True):
    """
    Thu thập danh sách body 3D trong phạm vi đã chọn (hỗ trợ cả Component mẹ đệ quy và ống lẻ),
    lọc trùng tuyệt đối theo fullPathName và tôn trọng trạng thái ẩn/hiện & Suppress theo chuỗi cha-con.
    """
    candidate_entries = []
    skipped_items = []
    seen_occ_paths = set()
    seen_body_keys = set()
    stats = {'visited_occs': 0, 'hidden_or_suppressed': 0, 'temp_skipped': 0}

    def record_skip(name, reason, kind):
        skipped_items.append({'name': name, 'reason': reason, 'kind': kind})
        if kind in ('hidden', 'suppressed'):
            stats['hidden_or_suppressed'] += 1
        elif kind == 'temp':
            stats['temp_skipped'] += 1

    def walk_occurrence(occ):
        if occ is None:
            return
        occ_path = get_occ_full_path(occ)
        if occ_path in seen_occ_paths:
            return
        seen_occ_paths.add(occ_path)
        stats['visited_occs'] += 1

        comp = getattr(occ, 'component', None)
        comp_name = getattr(comp, 'name', '') if comp is not None else getattr(occ, 'name', '')
        clean_occ_label = clean_instance_name(getattr(occ, 'name', '') or comp_name)

        if is_temp_export_component_name(comp_name):
            record_skip(clean_occ_label or comp_name, 'Component tạm từ lần xuất trước', 'temp')
            return

        if is_occ_suppressed_hierarchy(occ):
            record_skip(clean_occ_label or comp_name, 'Chi tiết đang bị Suppress', 'suppressed')
            return

        if skip_hidden and not is_occ_visible_hierarchy(occ):
            record_skip(clean_occ_label or comp_name, 'Component đang tắt đèn (ẩn)', 'hidden')
            return

        occ_bodies = getattr(occ, 'bRepBodies', None)
        if occ_bodies is not None and getattr(occ_bodies, 'count', 0) > 0:
            b_count = occ_bodies.count
            body_pairs = [
                (occ_bodies.item(b_idx), getattr(occ_bodies.item(b_idx), 'nativeObject', None) or occ_bodies.item(b_idx))
                for b_idx in range(b_count)
            ]
        elif comp is not None and getattr(comp, 'bRepBodies', None) is not None:
            comp_bodies = comp.bRepBodies
            b_count = comp_bodies.count
            body_pairs = []
            for b_idx in range(b_count):
                lb = comp_bodies.item(b_idx)
                pb = lb.createForAssemblyContext(occ) if hasattr(lb, 'createForAssemblyContext') else lb
                body_pairs.append((pb, lb))
        else:
            b_count = 0
            body_pairs = []

        for b_idx, (proxy_b, local_b) in enumerate(body_pairs):
            if not is_body_visible_hierarchy(proxy_b, local_b, comp, occ):
                if skip_hidden:
                    b_label = getattr(local_b, 'name', f'Body{b_idx + 1}')
                    record_skip(f"{clean_occ_label}_{b_label}", 'Body đang tắt đèn (ẩn)', 'hidden')
                    continue

            body_key = f"{occ_path}::body#{b_idx}"
            if body_key in seen_body_keys:
                continue
            seen_body_keys.add(body_key)

            b_name = getattr(local_b, 'name', f'Body{b_idx + 1}')
            name_hint = comp_name if b_count == 1 else f"{comp_name}_{b_name}"
            candidate_entries.append({
                'local_body': local_b,
                'proxy_body': proxy_b,
                'name_hint': name_hint,
                'comp': comp,
                'occ': occ,
                'full_path': body_key
            })

        children = getattr(occ, 'childOccurrences', None)
        if children is not None:
            for c_idx in range(children.count):
                walk_occurrence(children.item(c_idx))

    if use_root_mode:
        root_occs = getattr(root, 'occurrences', None)
        if root_occs is not None:
            for idx in range(root_occs.count):
                walk_occurrence(root_occs.item(idx))

        root_bodies = getattr(root, 'bRepBodies', None)
        rb_count = root_bodies.count if root_bodies is not None else 0
        for b_idx in range(rb_count):
            b = root_bodies.item(b_idx)
            if skip_hidden and not is_body_visible_hierarchy(b, b, root, None):
                record_skip(getattr(b, 'name', f'RootBody_{b_idx + 1}'), 'Body ở Root đang tắt đèn (ẩn)', 'hidden')
                continue
            body_key = f"__root__::body#{b_idx}"
            if body_key not in seen_body_keys:
                seen_body_keys.add(body_key)
                candidate_entries.append({
                    'local_body': b,
                    'proxy_body': b,
                    'name_hint': getattr(b, 'name', f'Body_{b_idx + 1}'),
                    'comp': root,
                    'occ': None,
                    'full_path': body_key
                })
    else:
        # Sắp xếp cha trước con (ít dấu '+' nhất trước) để lọc trùng ổn định bất kể thứ tự chọn
        ordered_sel = sorted(
            list(selected_occs or []),
            key=lambda o: get_occ_full_path(o).count('+')
        )
        for occ in ordered_sel:
            walk_occurrence(occ)

    return candidate_entries, skipped_items, stats


def classify_candidate_filter(local_body, proxy_body, raw_name_hint):
    """Kiểm tra sơ bộ trước khi chuẩn hóa 3D để loại tấm kim loại, ốc vít, bản mã và phụ kiện."""
    clean_hint = clean_instance_name(raw_name_hint)
    clean_lower = clean_hint.lower()

    if getattr(proxy_body, 'isSheetMetal', False) or getattr(local_body, 'isSheetMetal', False):
        return False, 'Tấm kim loại Sheet Metal'

    if any(kw in clean_lower for kw in EXCLUDE_KEYWORDS):
        return False, 'Phụ kiện / không phải ống hộp (theo tên)'

    try:
        bb_raw = local_body.boundingBox
        dx_raw = round((bb_raw.maxPoint.x - bb_raw.minPoint.x) * 10, 1)
        dy_raw = round((bb_raw.maxPoint.y - bb_raw.minPoint.y) * 10, 1)
        dz_raw = round((bb_raw.maxPoint.z - bb_raw.minPoint.z) * 10, 1)
        dims = sorted([dx_raw, dy_raw, dz_raw])
        if dims[0] <= 3.5 and dims[1] > 70:
            return False, 'Tấm phẳng mỏng (không phải ống/hộp)'
        if dims[0] < 5 or dims[2] < 25 or (dims[2] / max(dims[1], 1)) < 1.1:
            return False, 'Kích thước không phải thanh ống/hộp dài'
    except Exception:
        pass

    return True, ''


def detect_profile_name(norm_b, w_mm, h_mm, t, clean_hint):
    t_str = f"{int(t)}" if float(t).is_integer() else f"{t}"
    hint_lower = (clean_hint or '').lower()
    if abs(w_mm - h_mm) < 1.5:
        if re.search(r'(?:ống|ong|phi|ø)', hint_lower):
            d_int = int(round((w_mm + h_mm) / 2.0))
            return f'Ống Ø{d_int}x{t_str}'
        try:
            cyl_type = getattr(getattr(adsk.core, 'SurfaceTypes', None), 'CylinderSurfaceType', -1)
            plane_type = getattr(getattr(adsk.core, 'SurfaceTypes', None), 'PlaneSurfaceType', -2)
            cyl_area = 0.0
            side_plane_area = 0.0
            for f in norm_b.faces:
                stype = f.geometry.surfaceType
                if stype == cyl_type:
                    cyl_area += getattr(f, 'area', 0.0)
                elif stype == plane_type:
                    _, n = f.evaluator.getNormalAtPoint(f.pointOnFace)
                    if abs(n.z) < 0.25:
                        side_plane_area += getattr(f, 'area', 0.0)
            if cyl_area > 0 and side_plane_area == 0.0:
                d_int = int(round((w_mm + h_mm) / 2.0))
                return f'Ống Ø{d_int}x{t_str}'
        except Exception:
            pass
        w_int = int(round(w_mm))
        return f'Hộp {w_int}x{w_int}x{t_str}'
    w1 = int(round(max(w_mm, h_mm)))
    w2 = int(round(min(w_mm, h_mm)))
    return f'Hộp {w1}x{w2}x{t_str}'


def snapshot_visibility_state(root, des=None):
    """Lưu toàn bộ trạng thái ẩn/hiện hiện tại của bản vẽ để khôi phục nguyên trạng trong finally."""
    snap = {
        'root': root,
        'des': des,
        'active_occ': None,
        'root_bodies_folder': True,
        'root_bodies': [],
        'occurrences': [],
        'components': []
    }
    if des is not None:
        try:
            snap['active_occ'] = getattr(des, 'activeOccurrence', None)
        except Exception:
            snap['active_occ'] = None
    try:
        snap['root_bodies_folder'] = getattr(root, 'isBodiesFolderLightBulbOn', True)
    except Exception:
        pass
    try:
        r_bodies = getattr(root, 'bRepBodies', None)
        if r_bodies is not None:
            for i in range(r_bodies.count):
                b = r_bodies.item(i)
                snap['root_bodies'].append((b, getattr(b, 'isLightBulbOn', True)))
    except Exception:
        pass

    seen_comp_ids = set()
    try:
        all_occs = getattr(root, 'allOccurrences', None)
        if all_occs is not None:
            for i in range(all_occs.count):
                occ = all_occs.item(i)
                snap['occurrences'].append((occ, getattr(occ, 'isLightBulbOn', True)))
                comp = getattr(occ, 'component', None)
                if comp is not None and id(comp) not in seen_comp_ids:
                    seen_comp_ids.add(id(comp))
                    body_states = []
                    cb = getattr(comp, 'bRepBodies', None)
                    if cb is not None:
                        for j in range(cb.count):
                            b = cb.item(j)
                            body_states.append((b, getattr(b, 'isLightBulbOn', True)))
                    snap['components'].append((comp, getattr(comp, 'isBodiesFolderLightBulbOn', True), body_states))
    except Exception:
        pass

    return snap


def hide_all_for_isolated_export(root):
    """Tắt hiển thị toàn bộ bản vẽ gốc khi xuất .IGS để chỉ component tạm đang xuất được hiện."""
    try:
        r_bodies = getattr(root, 'bRepBodies', None)
        if r_bodies is not None:
            for i in range(r_bodies.count):
                try:
                    r_bodies.item(i).isLightBulbOn = False
                except Exception:
                    pass
    except Exception:
        pass
    # Ưu tiên tắt ở tầng Root occurrences để không làm xáo trộn trạng thái đèn riêng của component con
    top_occs = getattr(root, 'occurrences', None)
    if top_occs is not None and getattr(top_occs, 'count', 0) > 0:
        for i in range(top_occs.count):
            try:
                top_occs.item(i).isLightBulbOn = False
            except Exception:
                pass
    else:
        try:
            all_occs = getattr(root, 'allOccurrences', None)
            if all_occs is not None:
                for i in range(all_occs.count):
                    try:
                        all_occs.item(i).isLightBulbOn = False
                    except Exception:
                        pass
        except Exception:
            pass


def restore_visibility_state(snapshot):
    """Khôi phục nguyên trạng 100% bóng đèn hiển thị của Component và Body sau khi xuất xong hoặc gặp lỗi."""
    if not snapshot:
        return
    root = snapshot.get('root')
    if root is not None:
        try:
            root.isBodiesFolderLightBulbOn = snapshot.get('root_bodies_folder', True)
        except Exception:
            pass
    for b, state in snapshot.get('root_bodies', []):
        try:
            b.isLightBulbOn = state
        except Exception:
            pass
    for comp, folder_state, body_states in snapshot.get('components', []):
        try:
            comp.isBodiesFolderLightBulbOn = folder_state
        except Exception:
            pass
        for b, b_state in body_states:
            try:
                b.isLightBulbOn = b_state
            except Exception:
                pass
    # Khôi phục cha trước con để tránh lỗi toggle trạng thái con khi cha đang ẩn
    ordered_occs = sorted(
        list(snapshot.get('occurrences', [])),
        key=lambda pair: get_occ_full_path(pair[0]).count('+')
    )
    for occ, state in ordered_occs:
        try:
            occ.isLightBulbOn = state
        except Exception:
            pass
    act_occ = snapshot.get('active_occ')
    if act_occ is not None:
        try:
            act_occ.activate()
        except Exception:
            pass


def build_fast_preview_html(root, selected_occs, use_root_mode, skip_hidden, suggested_name):
    """Tạo nội dung tóm tắt nhanh trong hộp thoại Command Dialog khi người dùng thay đổi lựa chọn."""
    entries, skipped_items, stats = collect_scoped_candidates(
        root, selected_occs, use_root_mode=use_root_mode, skip_hidden=skip_hidden
    )
    pass_count = 0
    non_tube_count = 0
    for ent in entries:
        ok, _ = classify_candidate_filter(ent['local_body'], ent['proxy_body'], ent['name_hint'])
        if ok:
            pass_count += 1
        else:
            non_tube_count += 1

    scope_label = 'Toàn bộ bản vẽ (Root)' if use_root_mode else f'{len(selected_occs)} đối tượng đã chọn'
    hidden_count = stats.get('hidden_or_suppressed', 0)
    lines = [
        f"<b>Phạm vi:</b> {scope_label} (quét {stats.get('visited_occs', 0)} component)",
        f"<b>Tên dự án dự kiến:</b> {suggested_name}",
        f"<b>Ước tính chi tiết ống/hộp:</b> <span style='color:#0F766E;'><b>{pass_count} thanh</b></span>",
        f"<b>Đã bỏ qua:</b> {hidden_count} ẩn/Suppress · {non_tube_count} phụ kiện/tấm/ốc vít"
    ]
    if not use_root_mode and len(selected_occs) == 0:
        lines.append("<span style='color:#B91C1C;'>⚠ Vui lòng chọn ít nhất 1 Component mẹ hoặc ống lẻ (Ctrl/Shift để chọn nhiều).</span>")
    elif pass_count > 0:
        lines.append("<i>Bấm [Tiếp tục xuất .IGS] để chuẩn hóa 3D và xem bảng xác nhận chi tiết.</i>")
    return "<br>".join(lines)


def execute_export_workflow(app, ui, doc, des, root, selected_occs, use_root_mode, skip_hidden, chosen_project_name):
    """Thực hiện quét 3D chính xác, hiển thị hộp xác nhận, xuất IGS cô lập và đồng bộ lên Supabase."""
    em = des.exportManager
    tbm = adsk.fusion.TemporaryBRepManager.get()
    vis_snapshot = snapshot_visibility_state(root, des)

    try:
        # 1. Thu thập chi tiết theo đúng phạm vi đã chọn (lọc trùng & lọc ẩn)
        candidate_entries, skipped_items, _stats = collect_scoped_candidates(
            root, selected_occs, use_root_mode=use_root_mode, skip_hidden=skip_hidden
        )

        parts_dict = {}
        parts_by_prof = {}
        norm_bodies_by_key = {}
        total_tubes_count = 0

        # 2. Lọc hình học & chuẩn hóa tọa độ 3D từng chi tiết
        for ent in candidate_entries:
            orig_body = ent['local_body']
            proxy_body = ent['proxy_body']
            raw_name_hint = ent['name_hint']
            comp_ref = ent['comp']
            clean_hint = clean_instance_name(raw_name_hint)

            ok_pre, pre_reason = classify_candidate_filter(orig_body, proxy_body, raw_name_hint)
            if not ok_pre:
                skipped_items.append({'name': clean_hint, 'reason': pre_reason, 'kind': 'non_tube'})
                continue

            norm_b = normalize_body(tbm, orig_body)
            bb = norm_b.boundingBox
            w_mm = round((bb.maxPoint.x - bb.minPoint.x) * 10, 1)
            h_mm = round((bb.maxPoint.y - bb.minPoint.y) * 10, 1)
            l_max = round((bb.maxPoint.z - bb.minPoint.z) * 10, 1)
            l_cm = bb.maxPoint.z - bb.minPoint.z

            if (min(w_mm, h_mm) <= 5.0 and max(w_mm, h_mm) >= 40.0) or l_max < 25.0 or (l_max / max(w_mm, h_mm, 1.0)) < 1.1:
                skipped_items.append({'name': clean_hint, 'reason': 'Hình học sau chuẩn hóa không phải thanh ống/hộp', 'kind': 'non_tube'})
                continue

            t = detect_wall_thickness(norm_b, w_mm, h_mm, clean_hint)
            prof_name = detect_profile_name(norm_b, w_mm, h_mm, t, clean_hint)

            ns, ne = get_end_normals(norm_b, l_cm)
            ang_s = round(math.degrees(math.acos(max(-1.0, min(1.0, abs(ns.z))))), 1)
            ang_e = round(math.degrees(math.acos(max(-1.0, min(1.0, abs(ne.z))))), 1)
            is_m_start = ang_s >= 2.0
            is_m_end = ang_e >= 2.0
            miter_ends = (1 if is_m_start else 0) + (1 if is_m_end else 0)

            def calc_delta_z(n_vec):
                nz_clamped = max(abs(n_vec.z), 0.005)
                return (abs(n_vec.x) * w_mm + abs(n_vec.y) * h_mm) / nz_clamped

            delta_s = calc_delta_z(ns) if is_m_start else 0.0
            delta_e = calc_delta_z(ne) if is_m_end else 0.0

            if miter_ends == 2:
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
            extra_note = re.sub(
                r'^(?:Hộp|Hop|Ống|Ong|Phi|Ø)?\s*\d+\s*[xX\*×]\s*\d+(?:\s*[xX\*×]\s*\d+(?:[.,]\d+)?)?\s*(?:L|l)?\s*\d+(?:[.,]\d+)?',
                '', clean_hint, flags=re.I
            ).strip()
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

        hidden_skipped = [s for s in skipped_items if s.get('kind') in ('hidden', 'suppressed')]
        non_tube_skipped = [s for s in skipped_items if s.get('kind') == 'non_tube']

        if not parts_dict:
            no_tube_msg = 'Không tìm thấy chi tiết ống/hộp hợp lệ nào trong phạm vi đã chọn!\n\n'
            if skipped_items:
                no_tube_msg += f'Đã bỏ qua {len(hidden_skipped)} chi tiết ẩn/Suppress và {len(non_tube_skipped)} chi tiết không phải ống/hộp.'
            ui.messageBox(no_tube_msg, 'An Bình - Xuất IGS')
            return

        # 3. Hộp thoại tóm tắt & xác nhận trước khi xuất .IGS hàng loạt và đẩy lên Web
        scope_names = ['Toàn bộ bản vẽ (Root)'] if use_root_mode else [
            clean_instance_name(getattr(o, 'name', '') or getattr(getattr(o, 'component', None), 'name', ''))
            for o in selected_occs[:6]
        ]
        if not use_root_mode and len(selected_occs) > 6:
            scope_names.append(f'... và {len(selected_occs) - 6} cụm khác')

        confirm_lines = [
            'XÁC NHẬN XUẤT FILE .IGS & ĐẨY LÊN XEPPHOI.CLOUD',
            '',
            f'• Tên dự án dự kiến : {chosen_project_name}',
            f'• Phạm vi quét       : {", ".join(scope_names)}',
            f'• Tổng số thanh hợp lệ: {total_tubes_count} thanh ({len(parts_by_prof)} quy cách):'
        ]
        for p_name, items_d in parts_by_prof.items():
            p_cnt = sum(it['qty'] for it in items_d.values())
            confirm_lines.append(f'   + {p_name}: {p_cnt} thanh ({len(items_d)} kích thước)')

        confirm_lines.append('')
        confirm_lines.append(f'• Đã tự động bỏ qua  : {len(hidden_skipped)} chi tiết ẩn/Suppress, {len(non_tube_skipped)} phụ kiện/tấm/ốc vít')
        if non_tube_skipped:
            sample_skipped = ', '.join(s['name'] for s in non_tube_skipped[:5])
            if len(non_tube_skipped) > 5:
                sample_skipped += f', ... (+{len(non_tube_skipped) - 5})'
            confirm_lines.append(f'   (Mẫu bỏ qua: {sample_skipped})')

        confirm_lines.extend([
            '',
            'Bấm [Yes] để chọn thư mục lưu .IGS và đồng bộ lên Web App.',
            'Bấm [No] để hủy (trạng thái bản vẽ giữ nguyên).'
        ])

        yes_no = getattr(getattr(adsk.core, 'MessageBoxButtonTypes', None), 'YesNoButtonType', 1)
        q_icon = getattr(getattr(adsk.core, 'MessageBoxIconTypes', None), 'QuestionIconType', 2)
        dialog_yes = getattr(getattr(adsk.core, 'DialogResults', None), 'DialogYes', 2)
        confirm_res = ui.messageBox('\n'.join(confirm_lines), 'An Bình - Xác nhận xuất IGS', yes_no, q_icon)
        if confirm_res != dialog_yes:
            return

        # 4. Chọn thư mục lưu file .IGS
        folder_dlg = ui.createFolderDialog()
        folder_dlg.title = f'Chọn thư mục lưu file .IGS cho dự án: {chosen_project_name}'
        dlg_res = folder_dlg.showDialog()
        if dlg_res != adsk.core.DialogResults.DialogOK:
            return

        chosen_folder = folder_dlg.folder
        safe_proj_name = re.sub(r'[\/\\:*?"<>|]', '_', chosen_project_name).strip() or 'DuAn_Fusion360'
        if os.path.basename(chosen_folder).lower() == safe_proj_name.lower():
            export_dir = chosen_folder
        else:
            export_dir = os.path.join(chosen_folder, safe_proj_name)
        os.makedirs(export_dir, exist_ok=True)

        # Xóa các file .igs cũ trong thư mục đích
        for old_f in os.listdir(export_dir):
            if old_f.lower().endswith('.igs'):
                try:
                    os.remove(os.path.join(export_dir, old_f))
                except Exception:
                    pass

        # Lưu log các chi tiết đã bỏ qua để kỹ sư kiểm tra nếu cần
        if skipped_items:
            try:
                log_path = os.path.join(export_dir, 'skipped_items_log.txt')
                with open(log_path, 'w', encoding='utf-8') as f_log:
                    f_log.write(f"DANH SÁCH CHI TIẾT ĐÃ BỎ QUA — DỰ ÁN: {chosen_project_name}\n")
                    f_log.write("=" * 68 + "\n")
                    for sk in skipped_items:
                        f_log.write(f"- [{sk.get('kind', '')}] {sk.get('name', '')}: {sk.get('reason', '')}\n")
            except Exception:
                pass

        # Kích hoạt RootComponent & cô lập hiển thị (tắt đèn toàn bộ bản vẽ gốc trong khi xuất .IGS)
        if getattr(des, 'activeComponent', root) != root:
            try:
                des.activateRootComponent()
            except Exception:
                pass
        hide_all_for_isolated_export(root)

        # 5. XUẤT CÁC FILE .IGS CHI TIẾT LẺ KÈM HẬU TỐ SỐ LƯỢNG "SL <qty>"
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
            except Exception:
                pass

            igs_text = ''
            if os.path.exists(igs_path):
                try:
                    with open(igs_path, 'r', encoding='utf-8', errors='ignore') as f_in:
                        igs_text = f_in.read()
                except Exception:
                    pass

            parts_list.append({
                'name': clean_part_name,
                'profile': prof_name,
                'length': p['length'],
                'qty': qty,
                'style': style,
                'mat': p['mat'],
                'igs_file': igs_path.replace('\\', '/'),
                'igs_content': igs_text,
                'file_size': os.path.getsize(igs_path) if os.path.exists(igs_path) else 0
            })

        # 6. XUẤT ĐẦY ĐỦ TẤT CẢ FILE .IGS CÁC CÂY GHÉP 6M CHO MỌI LOẠI HỘP
        stock_len = 6000.0
        clamp_len = 80.0
        usable_len = stock_len - clamp_len
        kerf = 0.0
        bar_exports = []
        alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

        script_dir = os.path.dirname(__file__)
        candidate_engine_dirs = [
            script_dir,
            'C:/Users/Administrator/toiuu-phoi',
            'C:/Users/Administrator/Fusion360/toiuu-phoi'
        ]

        for src_dir in ['C:/Users/Administrator/toiuu-phoi', 'C:/Users/Administrator/Fusion360/toiuu-phoi']:
            for fn in ['run_engine_helper.js', 'toi-uu-engine.js']:
                sf = os.path.join(src_dir, fn)
                df = os.path.join(script_dir, fn)
                if os.path.exists(sf) and not os.path.exists(df):
                    try:
                        shutil.copy2(sf, df)
                    except Exception:
                        pass

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

        for gb in grouped_bars:
            letter = gb['letter']
            prof_name = gb['profile']
            bar_count = gb['count']
            safe_prof_str = prof_name.replace(' ', '_')
            bar_name = f"Cay_{letter}_{safe_prof_str}_L{int(stock_len)}_SL_{bar_count}"
            safe_bar_name = re.sub(r'[\/\\:*?"<>|]', '_', bar_name)
            igs_bar_path = os.path.join(export_dir, f"{safe_bar_name}.igs")

            bar_occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
            try:
                bar_occ.isLightBulbOn = True
            except Exception:
                pass
            bar_comp = bar_occ.component
            bar_comp.name = safe_bar_name

            try:
                try:
                    bar_comp.isBodiesFolderLightBulbOn = True
                except Exception:
                    pass
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
                            try:
                                new_b.isLightBulbOn = True
                            except Exception:
                                pass
                    bf.finishEdit()
                else:
                    for b_item, p_info in placed_bodies:
                        new_b = bar_comp.bRepBodies.add(b_item)
                        if new_b:
                            raw_hint = parts_dict.get(p_info['key'], {}).get('raw_name') or p_info.get('key', '')
                            clean_short = re.sub(r'^(?:Hộp|Hop|Ống|Ong)?\s*\d+\s*[xX\*×]\s*\d+(?:\s*[xX\*×]\s*\d+(?:[.,]\d+)?)?', '', raw_hint, flags=re.I).strip()
                            new_b.name = clean_short if clean_short else f"L{int(p_info['length'])}"
                            try:
                                new_b.isLightBulbOn = True
                            except Exception:
                                pass

                igs_opts = em.createIGESExportOptions(igs_bar_path, bar_comp)
                em.execute(igs_opts)

                igs_text = ''
                if os.path.exists(igs_bar_path):
                    try:
                        with open(igs_bar_path, 'r', encoding='utf-8', errors='ignore') as f_igs:
                            igs_text = f_igs.read()
                    except Exception:
                        pass

                bar_exports.append({
                    'letter': letter,
                    'name': safe_bar_name,
                    'profile': prof_name,
                    'stock_length': stock_len,
                    'cuts_count': len(placed_bodies),
                    'bar_count': bar_count,
                    'pieces': gb.get('pieces', []),
                    'igs_file': igs_bar_path.replace('\\', '/'),
                    'file_size': os.path.getsize(igs_bar_path) if os.path.exists(igs_bar_path) else 0,
                    'igs_content': igs_text
                })
            except Exception:
                pass
            finally:
                bar_occ.deleteMe()

        # 7. Lưu file JSON dữ liệu dự án (dùng tên dự án đã gợi ý/chỉnh sửa)
        payload_data = {
            'project_name': chosen_project_name,
            'source_document': doc.name,
            'scope_mode': 'root' if use_root_mode else 'selection',
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

        # 8. Lưu bản sao HTML dự phòng & gọi Cầu nối Node server.js -> Supabase
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

        import urllib.request
        import urllib.error
        import urllib.parse
        import time

        server_url = "http://localhost:3000"
        lan_url_display = server_url
        pushed_to_server = False
        supabase_synced = False
        igs_uploaded_count = 0
        was_versioned = False
        synced_project_id = ""
        synced_project_name = chosen_project_name
        sync_error_msg = ""

        def is_server_alive():
            try:
                req = urllib.request.Request(f"{server_url}/api/info", method='GET')
                with urllib.request.urlopen(req, timeout=1.5) as resp:
                    return resp.status == 200
            except Exception:
                return False

        if not is_server_alive():
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
                    creationflags = 0x08000000 if os.name == 'nt' else 0
                    subprocess.Popen(
                        [node_exe, server_js],
                        cwd=os.path.dirname(server_js),
                        creationflags=creationflags,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    for _ in range(16):
                        time.sleep(0.3)
                        if is_server_alive():
                            break
                except Exception as start_err:
                    sync_error_msg = f"Không tự khởi động được server.js: {start_err}"

        post_bytes = json.dumps(payload_data, ensure_ascii=False).encode('utf-8')
        try:
            req = urllib.request.Request(
                f"{server_url}/api/fusion-import",
                data=post_bytes,
                headers={'Content-Type': 'application/json; charset=utf-8'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=25) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                if resp_data.get('success'):
                    pushed_to_server = True
                    supabase_synced = bool(resp_data.get('supabaseSynced'))
                    igs_uploaded_count = int(resp_data.get('igsUploadedCount') or 0)
                    was_versioned = bool(resp_data.get('wasVersioned'))
                    synced_project_id = str(resp_data.get('projectId') or '')
                    synced_project_name = str(resp_data.get('projectName') or chosen_project_name)
                    lan_list = resp_data.get('lanUrls') or []
                    if len(lan_list) > 0 and lan_list[0].get('url'):
                        lan_url_display = lan_list[0]['url']
                else:
                    sync_error_msg = str(resp_data.get('error') or 'Server trả về lỗi không xác định')
        except urllib.error.HTTPError as http_err:
            try:
                err_body = http_err.read().decode('utf-8', errors='replace')
                err_json = json.loads(err_body)
                sync_error_msg = str(err_json.get('error') or err_body)
            except Exception:
                sync_error_msg = f"HTTP {http_err.code}: {http_err.reason}"
        except Exception as req_err:
            if not sync_error_msg:
                sync_error_msg = str(req_err)

        permanent_custom_url = "https://xepphoi.cloud"
        if synced_project_id:
            q_pid = urllib.parse.quote(synced_project_id, safe='')
            project_web_url = f"{permanent_custom_url}/?project={q_pid}"
            project_cnc_url = f"{permanent_custom_url}/cnc/?project={q_pid}"
            local_proj_url = f"{server_url}/?project={q_pid}"
        else:
            project_web_url = permanent_custom_url
            project_cnc_url = f"{permanent_custom_url}/cnc/"
            local_proj_url = server_url

        if supabase_synced:
            target_web_url = project_web_url
        elif pushed_to_server:
            target_web_url = local_proj_url
        else:
            target_web_url = project_web_url

        webbrowser.open(target_web_url)

        prof_names_str = ", ".join(parts_by_prof.keys())
        db_status_text = "✅ ĐÃ ĐỒNG BỘ SUPABASE" if supabase_synced else (
            "⚠️ CHỈ LƯU CỤC BỘ (Chưa đẩy lên Supabase)" if pushed_to_server else "❌ CHƯA KẾT NỐI ĐƯỢC SERVER CẦU NỐI (localhost:3000)"
        )
        header_icon = "✓" if supabase_synced else "⚠️"
        msg = f"{header_icon} KẾT QUẢ XUẤT BẢN VẼ FUSION 360: {synced_project_name}\n\n"
        msg += f"• Trạng thái Supabase DB : {db_status_text}\n"
        msg += f"• Upload .IGS Storage    : {igs_uploaded_count} file (bucket 'igs-files')\n"
        if was_versioned:
            msg += f"• Bảo vệ khóa dự án      : 🔒 Bản \"{chosen_project_name}\" đang khóa → Tự tạo bản mới \"{synced_project_name}\"\n"
        if sync_error_msg and not supabase_synced:
            msg += f"• Chi tiết lỗi           : {sync_error_msg}\n"
        msg += f"• Các loại hộp phát hiện ({len(parts_by_prof)} loại): {prof_names_str}\n"
        msg += f"• Tổng số chi tiết xuất  : {total_tubes_count} thanh\n"
        msg += f"• Đã lọc bỏ tự động      : {len(hidden_skipped)} ẩn/Suppress · {len(non_tube_skipped)} phụ kiện/tấm\n\n"
        msg += f"★ CÁC CÂY GHÉP 6M (LIỀN MẠCH - KHÍT MÒI 100%): {len(bar_exports)} file .IGS\n"
        for be in bar_exports:
            msg += f"   ➔ {be['name']}.igs ({be['profile']} · Ghép {be['cuts_count']} ct · SL: {be['bar_count']} cây)\n"
        msg += f"\n🌍 LINK MỞ NHANH DỰ ÁN NÀY TRÊN XEPPHOI.CLOUD:\n"
        msg += f"   • Bàn xếp phôi : {project_web_url}\n"
        msg += f"   • Màn hình CNC : {project_cnc_url}\n"
        if pushed_to_server and lan_url_display != server_url:
            msg += f"   • Mạng LAN     : {lan_url_display}\n"
        msg += f"\n📂 Thư mục lưu file .IGS cục bộ: {export_dir}"

        ui.messageBox(msg, 'An Bình - Đồng Bộ Supabase & Xuất IGS')
    finally:
        # Khôi phục lại 100% bóng đèn ẩn/hiện nguyên bản kể cả khi gặp lỗi hoặc hủy giữa chừng
        restore_visibility_state(vis_snapshot)


def _get_selected_occurrences_from_input(sel_input):
    occs = []
    if sel_input is None:
        return occs
    seen = set()
    for i in range(sel_input.selectionCount):
        ent = getattr(sel_input.selection(i), 'entity', None)
        if ent is None:
            continue
        occ = _cast_entity(getattr(adsk.fusion, 'Occurrence', None), ent) or ent
        fp = get_occ_full_path(occ)
        if fp not in seen:
            seen.add(fp)
            occs.append(occ)
    return occs


def _is_root_mode_selected(scope_input):
    if scope_input is None:
        return False
    try:
        item = scope_input.selectedItem
        return bool(item and 'Root' in item.name)
    except Exception:
        return False


class _BaseInputChangedHandler(_CoreInputChangedBase):
    def __init__(self, root):
        super().__init__()
        self.root = root

    def notify(self, args):
        try:
            changed = args.input
            inputs = args.inputs
            scope_inp = adsk.core.RadioButtonGroupCommandInput.cast(inputs.itemById('scope_mode'))
            sel_inp = adsk.core.SelectionCommandInput.cast(inputs.itemById('target_selection'))
            skip_inp = adsk.core.BoolValueCommandInput.cast(inputs.itemById('skip_hidden'))
            name_inp = adsk.core.StringValueCommandInput.cast(inputs.itemById('project_name'))
            prev_inp = adsk.core.TextBoxCommandInput.cast(inputs.itemById('preview_box'))

            if changed and changed.id == 'project_name':
                if not _session.get('programmatic_name_update'):
                    _session['user_edited_name'] = True
                return

            use_root = _is_root_mode_selected(scope_inp)
            skip_hidden = bool(skip_inp.value) if skip_inp else True

            if sel_inp is not None:
                sel_inp.isVisible = not use_root
                sel_inp.isEnabled = not use_root

            sel_occs = _get_selected_occurrences_from_input(sel_inp)
            suggested = suggest_project_name(sel_occs, _session.get('doc_name', ''), use_root_mode=use_root)

            if name_inp is not None and not _session.get('user_edited_name'):
                _session['programmatic_name_update'] = True
                try:
                    name_inp.value = suggested
                finally:
                    _session['programmatic_name_update'] = False

            cur_name = (name_inp.value.strip() if name_inp and name_inp.value else '') or suggested
            if prev_inp is not None:
                prev_inp.formattedText = build_fast_preview_html(
                    self.root, sel_occs, use_root, skip_hidden, cur_name
                )
        except Exception:
            pass


class _BaseValidateInputsHandler(_CoreValidateInputsBase):
    def notify(self, args):
        try:
            inputs = args.inputs
            scope_inp = adsk.core.RadioButtonGroupCommandInput.cast(inputs.itemById('scope_mode'))
            sel_inp = adsk.core.SelectionCommandInput.cast(inputs.itemById('target_selection'))
            name_inp = adsk.core.StringValueCommandInput.cast(inputs.itemById('project_name'))
            use_root = _is_root_mode_selected(scope_inp)
            has_scope = use_root or (sel_inp is not None and sel_inp.selectionCount > 0)
            has_name = bool(name_inp and name_inp.value and name_inp.value.strip())
            args.areInputsValid = bool(has_scope and has_name)
        except Exception:
            args.areInputsValid = True


class _BaseExecuteHandler(_CoreCommandEventBase):
    def __init__(self, app, ui, doc, des, root):
        super().__init__()
        self.app = app
        self.ui = ui
        self.doc = doc
        self.des = des
        self.root = root

    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            scope_inp = adsk.core.RadioButtonGroupCommandInput.cast(inputs.itemById('scope_mode'))
            sel_inp = adsk.core.SelectionCommandInput.cast(inputs.itemById('target_selection'))
            skip_inp = adsk.core.BoolValueCommandInput.cast(inputs.itemById('skip_hidden'))
            name_inp = adsk.core.StringValueCommandInput.cast(inputs.itemById('project_name'))

            use_root = _is_root_mode_selected(scope_inp)
            skip_hidden = bool(skip_inp.value) if skip_inp else True
            sel_occs = _get_selected_occurrences_from_input(sel_inp)
            chosen_name = (name_inp.value.strip() if name_inp and name_inp.value else '') or suggest_project_name(
                sel_occs, getattr(self.doc, 'name', ''), use_root_mode=use_root
            )

            execute_export_workflow(
                self.app, self.ui, self.doc, self.des, self.root,
                sel_occs, use_root, skip_hidden, chosen_name
            )
        except Exception:
            if self.ui:
                self.ui.messageBox('Lỗi khi bóc tách & ghép cây: {}'.format(traceback.format_exc()), 'An Bình - Xuất IGS')


class _BaseDestroyHandler(_CoreCommandEventBase):
    def __init__(self, ui):
        super().__init__()
        self.ui = ui

    def notify(self, args):
        try:
            cmd_def = self.ui.commandDefinitions.itemById(CMD_ID)
            if cmd_def:
                cmd_def.deleteMe()
        except Exception:
            pass
        _handlers.clear()
        try:
            adsk.terminate()
        except Exception:
            pass


class _BaseCommandCreatedHandler(_CoreCommandCreatedBase):
    def __init__(self, app, ui, doc, des, root):
        super().__init__()
        self.app = app
        self.ui = ui
        self.doc = doc
        self.des = des
        self.root = root

    def notify(self, args):
        try:
            cmd = args.command
            cmd.isExecutedWhenPreEmpted = False
            cmd.okButtonText = 'Tiếp tục xuất .IGS'
            try:
                cmd.setDialogMinimumSize(460, 480)
                cmd.setDialogInitialSize(500, 560)
            except Exception:
                pass

            inputs = cmd.commandInputs
            pre_occs = _session.get('preselected_occs') or []
            use_root_default = False

            scope_inp = inputs.addRadioButtonGroupCommandInput('scope_mode', 'Phạm vi xuất phôi')
            scope_inp.listItems.add('Theo vùng chọn (Component mẹ / Ống lẻ)', not use_root_default)
            scope_inp.listItems.add('Xuất toàn bộ bản vẽ (Root)', use_root_default)

            sel_inp = inputs.addSelectionInput(
                'target_selection',
                'Chọn Component / Ống hộp',
                'Bấm trực tiếp trên mô hình 3D hoặc cây Browser (Ctrl/Shift chọn nhiều)'
            )
            sel_inp.addSelectionFilter('Occurrences')
            sel_inp.setSelectionLimits(0, 0)
            for occ in pre_occs:
                try:
                    sel_inp.addSelection(occ)
                except Exception:
                    pass

            inputs.addBoolValueInput(
                'skip_hidden',
                'Bỏ qua chi tiết đang ẩn (tắt đèn) / Suppress',
                True,
                '',
                True
            )

            default_name = suggest_project_name(pre_occs, _session.get('doc_name', ''), use_root_mode=use_root_default)
            inputs.addStringValueInput('project_name', 'Tên dự án xuất lên web', default_name)

            preview_html = build_fast_preview_html(self.root, pre_occs, use_root_default, True, default_name)
            inputs.addTextBoxCommandInput('preview_box', 'Tóm tắt nhanh', preview_html, 8, True)

            h_chg = _BaseInputChangedHandler(self.root)
            cmd.inputChanged.add(h_chg)
            _handlers.append(h_chg)

            h_val = _BaseValidateInputsHandler()
            cmd.validateInputs.add(h_val)
            _handlers.append(h_val)

            h_exec = _BaseExecuteHandler(self.app, self.ui, self.doc, self.des, self.root)
            cmd.execute.add(h_exec)
            _handlers.append(h_exec)

            h_dest = _BaseDestroyHandler(self.ui)
            cmd.destroy.add(h_dest)
            _handlers.append(h_dest)
        except Exception:
            if self.ui:
                self.ui.messageBox('Lỗi khởi tạo hộp thoại xuất IGS: {}'.format(traceback.format_exc()), 'An Bình - Xuất IGS')


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

        root = des.rootComponent
        # Quan trọng: đọc activeSelections TRƯỚC KHI tạo hộp thoại / không kích hoạt Root để giữ nguyên vùng chọn sẵn
        pre_occs = resolve_preselected_occurrences(ui, root, des)

        _handlers.clear()
        _session.clear()
        _session['preselected_occs'] = pre_occs
        _session['doc_name'] = getattr(doc, 'name', 'DuAn_Fusion360')
        _session['user_edited_name'] = False
        _session['programmatic_name_update'] = False

        old_def = ui.commandDefinitions.itemById(CMD_ID)
        if old_def:
            old_def.deleteMe()

        cmd_def = ui.commandDefinitions.addButtonDefinition(
            CMD_ID,
            'Xuất IGS & Tối Ưu Phôi (An Bình)',
            'Chọn Component mẹ hoặc các ống/hộp lẻ để xuất .IGS và đồng bộ lên xepphoi.cloud'
        )
        h_created = _BaseCommandCreatedHandler(app, ui, doc, des, root)
        cmd_def.commandCreated.add(h_created)
        _handlers.append(h_created)

        adsk.autoTerminate(False)
        cmd_def.execute()
    except Exception:
        if ui:
            ui.messageBox('Lỗi khi khởi chạy script xuất IGS: {}'.format(traceback.format_exc()), 'An Bình - Xuất IGS')
        try:
            adsk.terminate()
        except Exception:
            pass


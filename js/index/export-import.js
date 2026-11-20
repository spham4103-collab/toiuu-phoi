/**
 * Module: export-import.js - Exporters & Parsers (IGES 3D, Zalo, CSV, Quick Paste)
 * Xuất mô hình 3D IGES cây ghép, sao chép Zalo, tải CSV và nạp phôi nhanh
 */

    // Xuất file 3D IGES cho cả cây ghép với Bề mặt 3D (Entity 128 B-Spline Surface) chuẩn xác 100% 80 ký tự ASCII
    function exportNestedBarIGES(fileName, profile, stockLen, pieces) {
      let w = 20, h = 20, t = 1.2;
      const mBox = String(profile || '').match(/(\d+)\s*[xX\*×]\s*(\d+)(?:\s*[xX\*×]\s*(\d+(?:[.,]\d+)?))?/);
      if (mBox) {
        w = parseFloat(mBox[1]);
        h = parseFloat(mBox[2]);
        if (mBox[3]) t = parseFloat(mBox[3].replace(',', '.'));
      }
      if (pieces && pieces.length) {
        const miterPiece = pieces.find(p => (p.eL && p.eL !== 'S') || (p.eR && p.eR !== 'S'));
        if (miterPiece && miterPiece.w && Math.abs(miterPiece.w - h) < Math.abs(miterPiece.w - w)) {
          const tmp = w; w = h; h = tmp;
        }
      }

      const surfaces = [];
      const lines = [];
      const round = v => Number(v.toFixed(3));

      // Tạo mặt phẳng 3D bilinear B-Spline Surface (Entity 128)
      const makeQuad = (p00, p10, p01, p11) => [
        128, 1, 1, 1, 1, 0, 0, 1, 0, 0,
        0.0, 0.0, 1.0, 1.0,
        0.0, 0.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 1.0,
        round(p00[0]), round(p00[1]), round(p00[2]),
        round(p10[0]), round(p10[1]), round(p10[2]),
        round(p01[0]), round(p01[1]), round(p01[2]),
        round(p11[0]), round(p11[1]), round(p11[2]),
        0.0, 1.0, 0.0, 1.0
      ];

      // Thêm đường viền wireframe (Entity 110)
      const addLine = (p0, p1) => {
        lines.push([
          110,
          round(p0[0]), round(p0[1]), round(p0[2]),
          round(p1[0]), round(p1[1]), round(p1[2])
        ]);
      };

      const x0 = -w / 2, x1 = w / 2;
      const y0 = -h / 2, y1 = h / 2;
      const hasInner = (w > 2 * t && h > 2 * t);
      const ix0 = x0 + t, ix1 = x1 - t;
      const iy0 = y0 + t, iy1 = y1 - t;

      const tubePieces = (pieces && pieces.length) ? pieces : [{ xt0: 0, xb0: 0, xt1: stockLen, xb1: stockLen }];

      tubePieces.forEach(p => {
        const zt0 = p.xt0 !== undefined ? p.xt0 : (p.xL || 0);
        const zb0 = p.xb0 !== undefined ? p.xb0 : zt0;
        const zt1 = p.xt1 !== undefined ? p.xt1 : (p.xR || (p.length || stockLen));
        const zb1 = p.xb1 !== undefined ? p.xb1 : zt1;

        // 4 mặt ngoài (Top, Bot, Left, Right)
        surfaces.push(makeQuad([x0, y0, zt0], [x1, y0, zb0], [x0, y0, zt1], [x1, y0, zb1]));
        surfaces.push(makeQuad([x0, y1, zt0], [x1, y1, zb0], [x0, y1, zt1], [x1, y1, zb1]));
        surfaces.push(makeQuad([x0, y0, zt0], [x0, y1, zt0], [x0, y0, zt1], [x0, y1, zt1]));
        surfaces.push(makeQuad([x1, y0, zb0], [x1, y1, zb0], [x1, y0, zb1], [x1, y0, zb1]));

        // 4 đường gân cạnh ngoài
        addLine([x0, y0, zt0], [x0, y0, zt1]);
        addLine([x0, y1, zt0], [x0, y1, zt1]);
        addLine([x1, y0, zb0], [x1, y0, zb1]);
        addLine([x1, y1, zb0], [x1, y1, zb1]);

        if (hasInner) {
          const izt0 = zt0 + (zb0 - zt0) * (t / w);
          const izb0 = zt0 + (zb0 - zt0) * ((w - t) / w);
          const izt1 = zt1 + (zb1 - zt1) * (t / w);
          const izb1 = zt1 + (zb1 - zt1) * ((w - t) / w);

          // 4 mặt trong rỗng
          surfaces.push(makeQuad([ix0, iy0, izt0], [ix1, iy0, izb0], [ix0, iy0, izt1], [ix1, iy0, izb1]));
          surfaces.push(makeQuad([ix0, iy1, izt0], [ix1, iy1, izb0], [ix0, iy1, izt1], [ix1, iy1, izb1]));
          surfaces.push(makeQuad([ix0, iy0, izt0], [ix0, iy1, izt0], [ix0, iy0, izt1], [ix0, iy1, izt1]));
          surfaces.push(makeQuad([ix1, iy0, izb0], [ix1, iy1, izb0], [ix1, iy0, izb1], [ix1, iy1, izb1]));

          // 4 đường gân trong
          addLine([ix0, iy0, izt0], [ix0, iy0, izt1]);
          addLine([ix0, iy1, izt0], [ix0, iy1, izt1]);
          addLine([ix1, iy0, izb0], [ix1, iy0, izb1]);
          addLine([ix1, iy1, izb0], [ix1, iy1, izb1]);

          // Mặt nắp vát ở 2 đầu cắt (giữa thành ngoài và thành trong)
          const addEndFaces = (zt, zb, izt, izb) => {
            surfaces.push(makeQuad([x0, y0, zt], [x1, y0, zb], [ix0, iy0, izt], [ix1, iy0, izb]));
            surfaces.push(makeQuad([x0, y1, zt], [x1, y1, zb], [ix0, iy1, izt], [ix1, iy1, izb]));
            surfaces.push(makeQuad([x0, y0, zt], [x0, y1, zt], [ix0, iy0, izt], [ix0, iy1, izt]));
            surfaces.push(makeQuad([x1, y0, zb], [x1, y1, zb], [ix1, iy0, izb], [ix1, iy1, izb]));

            addLine([x0, y0, zt], [x1, y0, zb]);
            addLine([x1, y0, zb], [x1, y1, zb]);
            addLine([x1, y1, zb], [x0, y1, zt]);
            addLine([x0, y1, zt], [x0, y0, zt]);

            addLine([ix0, iy0, izt], [ix1, iy0, izb]);
            addLine([ix1, iy0, izb], [ix1, iy1, izb]);
            addLine([ix1, iy1, izb], [ix0, iy1, izt]);
            addLine([ix0, iy1, izt], [ix0, iy0, izt]);
          };
          addEndFaces(zt0, zb0, izt0, izb0);
          addEndFaces(zt1, zb1, izt1, izb1);
        } else {
          // Đầu đặc
          surfaces.push(makeQuad([x0, y0, zt0], [x1, y0, zb0], [x0, y1, zt0], [x1, y1, zb0]));
          surfaces.push(makeQuad([x0, y0, zt1], [x1, y0, zb1], [x0, y1, zt1], [x1, y1, zb1]));
          addLine([x0, y0, zt0], [x1, y0, zb0]);
          addLine([x1, y0, zb0], [x1, y1, zb0]);
          addLine([x1, y1, zb0], [x0, y1, zt0]);
          addLine([x0, y1, zt0], [x0, y0, zt0]);
          addLine([x0, y0, zt1], [x1, y0, zb1]);
          addLine([x1, y0, zb1], [x1, y1, zb1]);
          addLine([x1, y1, zb1], [x0, y1, zt1]);
          addLine([x0, y1, zt1], [x0, y0, zt1]);
        }
      });

      // Tạo các Section IGES với độ dài chuẩn xác 80 ký tự thuần ASCII
      const cleanFileName = toAscii(fileName).replace(/[^\w\.\-]/g, '_');
      const cleanProf = toAscii(profile).replace(/[^\w\.\-\s]/g, '_');
      const sDesc = `An Binh nested tube 3D IGES - ${cleanProf} L${stockLen}`;
      const sLine = sDesc.slice(0, 72).padEnd(72, ' ') + 'S      1\r\n';

      const fnHol = cleanFileName.length + 'H' + cleanFileName;
      const gFields = [
        '1H,', '1H;', fnHol, fnHol, '7HAn Binh',
        '10HWeb nesting', '32', '38', '7', '99', '15', '', '1.0', '2', '2HMM', '1', '0.08',
        '15H20261118.210000', '0.01', String(stockLen) + '.0', '7HAn Binh', '7HAn Binh', '11', '0'
      ];
      let gLines = [];
      let curG = '';
      for (let i = 0; i < gFields.length; i++) {
        const item = gFields[i] + (i === gFields.length - 1 ? ';' : ',');
        if (curG.length + item.length > 72) {
          gLines.push(curG.slice(0, 72).padEnd(72, ' '));
          curG = item;
        } else {
          curG += item;
        }
      }
      if (curG.length > 0) gLines.push(curG.slice(0, 72).padEnd(72, ' '));
      const gSec = gLines.map((l, idx) => l.slice(0, 72).padEnd(72, ' ') + 'G' + String(idx + 1).padStart(7, ' ')).join('\r\n') + '\r\n';

      let dLines = [];
      let pLines = [];
      let dSeq = 1;
      let pSeq = 1;

      // Đóng gói surfaces (Entity 128)
      surfaces.forEach(params => {
        const dePtr = dSeq;
        const pStart = pSeq;
        let entityPLines = [];
        let curP = '';
        for (let k = 0; k < params.length; k++) {
          const tok = String(params[k]) + (k === params.length - 1 ? ';' : ',');
          if (curP.length + tok.length > 64) {
            entityPLines.push(curP.slice(0, 64).padEnd(64, ' '));
            curP = tok;
          } else {
            curP += tok;
          }
        }
        if (curP.length > 0) entityPLines.push(curP.slice(0, 64).padEnd(64, ' '));

        entityPLines.forEach(pl => {
          pLines.push(pl.slice(0, 64).padEnd(64, ' ') + String(dePtr).padStart(8, ' ') + 'P' + String(pSeq++).padStart(7, ' '));
        });

        const pLineCount = entityPLines.length;
        dLines.push(String(128).padStart(8, ' ') + String(pStart).padStart(8, ' ') + '       0' + '       1' + '       0' + '       0' + '       0' + '       0' + '00000000' + 'D' + String(dSeq++).padStart(7, ' '));
        dLines.push(String(128).padStart(8, ' ') + '       0' + '       3' + String(pLineCount).padStart(8, ' ') + '       0' + '        ' + '        ' + '    SURF' + '       0' + 'D' + String(dSeq++).padStart(7, ' '));
      });

      // Đóng gói wireframe edges (Entity 110)
      lines.forEach(params => {
        const dePtr = dSeq;
        const pStart = pSeq;
        const pData = params.join(',') + ';';
        pLines.push(pData.slice(0, 64).padEnd(64, ' ') + String(dePtr).padStart(8, ' ') + 'P' + String(pSeq++).padStart(7, ' '));

        dLines.push(String(110).padStart(8, ' ') + String(pStart).padStart(8, ' ') + '       0' + '       1' + '       0' + '       0' + '       0' + '       0' + '00000000' + 'D' + String(dSeq++).padStart(7, ' '));
        dLines.push(String(110).padStart(8, ' ') + '       0' + '       1' + String(1).padStart(8, ' ') + '       0' + '        ' + '        ' + '    LINE' + '       0' + 'D' + String(dSeq++).padStart(7, ' '));
      });

      const totalD = dLines.length;
      const totalP = pLines.length;
      const tLine = ('S      1G' + String(gLines.length).padStart(7, ' ') + 'D' + String(totalD).padStart(7, ' ') + 'P' + String(totalP).padStart(7, ' ')).slice(0, 72).padEnd(72, ' ') + 'T      1\r\n';

      const content = sLine + gSec + dLines.join('\r\n') + '\r\n' + pLines.join('\r\n') + '\r\n' + tLine;

      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const finalDlName = (cleanFileName.endsWith('.igs') ? cleanFileName : (cleanFileName + '.igs')).replace(/\.igs\.igs$/i, '.igs');
      a.download = finalDlName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`✓ Đã lưu file .IGS 3D cây ghép: ${finalDlName}`);
    }


    // Zalo Message Generator with Profile Grouping
    function generateZaloText() {
      const res = state.result;
      if (!res) return '';

      const u = res.usageStats;
      const numProfiles = res.summaryByProfile ? res.summaryByProfile.length : 1;
      const lines = [
        `AN BÌNH · TỐI ƯU XẾP PHÔI BẢN VẼ (${numProfiles} LOẠI HỘP) · ${new Date().toLocaleDateString('vi-VN')}`,
        `Tổng cộng: ${res.bars.length} cây (mua mới ${res.totalNewBars}, tồn kho ${res.totalExistingUsed}), dư ${numVN(u.totalWasteLength / 1000, 2)} m` +
        (u.totalInterlockSaving > 0 ? `, xen kẽ ke bớt ${numVN(u.totalInterlockSaving / 1000, 2)} m` : ''),
        '',
        '═════════════════════════════',
        '📦 VẬT TƯ CẦN THEO TỪNG LOẠI HỘP:'
      ];

      const profiles = res.summaryByProfile ? res.summaryByProfile.map(s => s.profile) : ['Chung'];
      profiles.forEach(prof => {
        const stocks = res.byStockType.filter(s => (s.profile || 'Chung') === prof && s.usedQty > 0);
        if (stocks.length) {
          lines.push(`\n▶ ${prof}:`);
          stocks.forEach(s => {
            lines.push(`  - ${s.label} (${numVN(s.length)} mm): ${s.availableQty === null ? `MUA MỚI ${s.usedQty} cây` : `lấy ${s.usedQty} cây tồn (có ${s.availableQty})`}`);
          });
        }
      });

      lines.push('', '═════════════════════════════', '✂️ SƠ ĐỒ CẮT CHI TIẾT (mm, từ trái qua):');

      profiles.forEach(prof => {
        const patterns = res.patterns.filter(p => (p.profile || 'Chung') === prof);
        if (patterns.length) {
          lines.push(`\n【${prof}】:`);
          const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          patterns.forEach((p, idx) => {
            const letter = alphabet[idx % alphabet.length];
            lines.push(`  Mẫu ${letter} × ${p.count} cây ${numVN(p.stockLength)} mm ${p.isNewPurchase ? '' : '(cây tồn)'}:`);

            const cutsGroup = [];
            p.cuts.forEach((c, k) => {
              const originalPart = state.parts.find(x => x.id === c.label);
              const styleName = c.endStyle === 'ke1' ? 'ke 1 đầu' : (c.endStyle === 'ke' ? 'ke 2 đầu' : '');
              const labelPart = originalPart && originalPart.name ? `${originalPart.name} ` : '';
              const cutDesc = `${labelPart}${numVN(c.length)}${styleName ? ` ${styleName}` : ''}`;

              const isChained = k > 0 && c.run >= 0 && c.pos > 0;
              const prev = cutsGroup[cutsGroup.length - 1];
              if (prev && prev.desc === cutDesc && !isChained && !prev.isChained) {
                prev.qty++;
              } else {
                cutsGroup.push({ desc: cutDesc, qty: 1, isChained });
              }
            });

            const cutsStr = cutsGroup.map(g => `${g.desc}${g.qty > 1 ? ` × ${g.qty}` : ''}${g.isChained ? ' (xen kẽ)' : ''}`).join(' + ');
            lines.push(`    ${cutsStr}`);
            lines.push(`    Dư ${numVN(Math.max(0, p.waste))} mm${p.interlockSaving > 0 ? `, xen kẽ bớt ${numVN(p.interlockSaving)} mm` : ''}`);
          });
        }
      });

      lines.push('', 'Ghi chú: ke 1 đầu = vát 45° một đầu, ke 2 đầu = vát 45° hai đầu; số đo là cạnh dài. (xen kẽ) = lật ngược miếng đó ghép chung một nhát cắt xiên.');
      return lines.join('\n');
    }

    // Export CSV
    function exportCSV() {
      const res = state.result;
      if (!res) return;

      const lines = [];
      lines.push('STT,Loại Hộp,Mẫu Cắt,Số Lượng Cây,Loại Phôi,Chiều Dài Phôi (mm),Các Chi Tiết Cắt (mm),Phôi Dư (mm),Bớt Nhờ Xen Kẽ (mm)');
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

      res.patterns.forEach((p, idx) => {
        const letter = alphabet[idx % alphabet.length];
        const cutsStr = p.cuts.map(c => `${c.length}${c.endStyle !== 'thang' ? `(${c.endStyle})` : ''}`).join(' + ');
        lines.push(`${idx + 1},"${p.profile || 'Chung'}",Mẫu ${letter},${p.count},"${p.stockLabel}",${p.stockLength},"${cutsStr}",${Math.max(0, p.waste)},${p.interlockSaving || 0}`);
      });

      const bom = '\uFEFF';
      const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AnBinh_ToiUuXepPhoi_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Đã xuất file CSV thành công!');
    }


    // ==========================================
    // IGES (.igs) 3D Geometry Parser for Tube Laser CNC
    // ==========================================
    function parseIGESFile(content, fileName) {
      if (!content || typeof content !== 'string') return null;
      const lines = content.split(/\r?\n/);
      let pData = '';
      let headerText = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length >= 73) {
          const sec = line[72];
          if (sec === 'G' || sec === 'S') {
            headerText += line.substring(0, 72) + ' ';
          } else if (sec === 'P') {
            pData += line.substring(0, 64).trimEnd();
          }
        }
      }

      // 1. Look for Hollerith strings in header
      const holleriths = [];
      const hollerithRegex = /(\d+)H([^\,\;]+)/g;
      let hm;
      while ((hm = hollerithRegex.exec(headerText)) !== null) {
        const val = hm[2].trim();
        if (val.length >= 4) holleriths.push(val);
      }

      // 2. Extract vertex coordinates (from Entity 502 or Entity 110 lines)
      // Hỗ trợ chuẩn ký hiệu khoa học Fortran 'D'/'d' (vd: -3.08D-14 -> 0.0) trong file IGES của Fusion 360
      const parseIgsFloat = s => parseFloat(String(s).trim().replace(/[dD]/g, 'E'));
      let pts = [];
      const m502 = pData.match(/502,(\d+),([\s\S]*?);/);
      if (m502) {
        const rawCoords = m502[2];
        const coords = rawCoords.split(',').map(parseIgsFloat).filter(n => !isNaN(n));
        for (let i = 0; i + 2 < coords.length; i += 3) {
          pts.push([coords[i], coords[i + 1], coords[i + 2]]);
        }
      } else {
        const entityMatches = pData.matchAll(/110,([-\d.,eEdD+]+);/g);
        for (const em of entityMatches) {
          const nums = em[1].split(',').map(parseIgsFloat).filter(n => !isNaN(n));
          if (nums.length >= 6) {
            pts.push([nums[0], nums[1], nums[2]]);
            pts.push([nums[3], nums[4], nums[5]]);
          }
        }
      }

      if (!pts.length) return null;

      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);
      const zs = pts.map(p => p[2]);

      const dx = Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100;
      const dy = Math.round((Math.max(...ys) - Math.min(...ys)) * 100) / 100;
      const dz = Math.round((Math.max(...zs) - Math.min(...zs)) * 100) / 100;

      const ranges = [dx, dy, dz];
      const axes = [0, 1, 2].sort((a, b) => ranges[a] - ranges[b]);
      const axH = axes[0], axW = axes[1], axL = axes[2];

      const w2 = ranges[axH]; // Cạnh nhỏ mặt cắt (H)
      const w1 = ranges[axW]; // Cạnh lớn mặt cắt (W)
      const length = Math.round(ranges[axL] * 10) / 10;

      // 3. Nhận diện góc vát mòi ke 45° chính xác theo độ phủ mặt cắt tại 2 đầu mút lMin và lMax
      // (Không bị nhầm với lỗ đục gần đầu ống và nhận diện chuẩn cả hộp chữ nhật 40x10 vát cạnh 10mm)
      const lVals = pts.map(p => p[axL]);
      const lMin = Math.min(...lVals);
      const lMax = Math.max(...lVals);
      const endTol = 0.8;

      const end1Pts = pts.filter(p => Math.abs(p[axL] - lMin) <= endTol);
      const end2Pts = pts.filter(p => Math.abs(p[axL] - lMax) <= endTol);

      const spanOf = (arr, ax) => arr.length ? (Math.max(...arr.map(p => p[ax])) - Math.min(...arr.map(p => p[ax]))) : 0;
      const wSpan1 = spanOf(end1Pts, axW), hSpan1 = spanOf(end1Pts, axH);
      const wSpan2 = spanOf(end2Pts, axW), hSpan2 = spanOf(end2Pts, axH);

      const isM1_W = wSpan1 < w1 * 0.5;
      const isM1_H = hSpan1 < w2 * 0.5;
      const isMiter1 = isM1_W || isM1_H;
      const mat1 = isM1_W ? w1 : (isM1_H ? w2 : w1);

      const isM2_W = wSpan2 < w1 * 0.5;
      const isM2_H = hSpan2 < w2 * 0.5;
      const isMiter2 = isM2_W || isM2_H;
      const mat2 = isM2_W ? w1 : (isM2_H ? w2 : w1);

      let style = 'thang';
      if (isMiter1 && isMiter2) style = 'ke';
      else if (isMiter1 || isMiter2) style = 'ke1';

      const mat = isMiter1 ? mat1 : (isMiter2 ? mat2 : w1);

      // Extract Part Name and Profile
      let cleanFileName = fileName.replace(/\.igs$/i, '').replace(/\.iges$/i, '');
      // Remove occurrence suffix like _1, _2 or :1, :2
      cleanFileName = cleanFileName.replace(/[:_]\d+$/, '').trim();

      const smartSpecs = detectSpecsFromText(cleanFileName);
      let profileName = '';
      if (smartSpecs && smartSpecs.detectedProfile) {
        profileName = smartSpecs.detectedProfile;
      } else {
        if (Math.abs(w1 - w2) < 2) {
          profileName = `Hộp ${Math.round(w1)}x${Math.round(w2)}`;
        } else {
          profileName = `Hộp ${Math.round(Math.max(w1, w2))}x${Math.round(Math.min(w1, w2))}`;
        }
      }

      const finalLength = (smartSpecs && smartSpecs.detectedLength) ? smartSpecs.detectedLength : length;
      const finalQty = (smartSpecs && smartSpecs.detectedQty) ? smartSpecs.detectedQty : 1;
      const finalStyle = (smartSpecs && smartSpecs.detectedStyle) ? smartSpecs.detectedStyle : style;

      // Chuẩn hóa tên chi tiết: loại bỏ phần "SL <số>" ở đuôi nếu có để tên sạch đẹp (vd: "Hộp 30x30x1.8 L640 lỗ ren (1)")
      const cleanPartName = cleanFileName.replace(/\s*SL\s*\d+\s*$/i, '').trim();

      return {
        name: cleanPartName || cleanFileName,
        profile: profileName,
        length: finalLength,
        style: finalStyle,
        mat: Math.round(mat) || extractMatFromProfile(profileName),
        qty: finalQty
      };
    }


    // Quick Paste Parser
    function parsePasteInput(text) {
      const lines = text.trim().split(/\r?\n/);
      const newParts = [];
      const curProf = state.selectedTabProfile !== 'ALL' ? state.selectedTabProfile : (state.activeProfiles[0] || 'Hộp 30x30x1.8');

      lines.forEach((line, i) => {
        const str = line.trim();
        if (!str) return;

        let name = '', profile = curProf, length = 0, qty = 1, style = 'thang', mat = 30;

        // Smart detect from line text first
        const specs = detectSpecsFromText(str);
        if (specs && specs.detectedProfile) {
          profile = specs.detectedProfile;
          if (!state.activeProfiles.includes(profile)) state.activeProfiles.push(profile);
          if (!state.savedProfiles.includes(profile)) {
            state.savedProfiles.push(profile);
            saveProfilesLibrary();
            renderMemoryLibraryChips();
          }
          ensureStockForProfile(profile);
          if (specs.detectedMat) mat = specs.detectedMat;
          if (specs.detectedStyle) style = specs.detectedStyle;
          if (specs.detectedQty) qty = specs.detectedQty;
          if (specs.detectedLength) length = specs.detectedLength;
        }

        if (str.includes('\t')) {
          const cols = str.split('\t').map(c => c.trim());
          if (cols.length >= 2) {
            name = cols[0];
            const parsedL = parseVN(cols[1]);
            if (parsedL > 0) length = parsedL;
            if (cols[2]) qty = parseInt(cols[2]) || qty;
            if (cols[3]) {
              const s = cols[3].toLowerCase();
              if (s.includes('ke1') || s.includes('1')) style = 'ke1';
              else if (s.includes('ke') || s.includes('2')) style = 'ke';
            }
            if (cols[4]) mat = parseVN(cols[4]) || mat;
          }
        } else if (!length) {
          const numMatch = str.match(/(\d+(?:[.,]\d+)?)\s*(?:x|\*|\s)\s*(\d+)(.*)/i);
          if (numMatch) {
            length = parseVN(numMatch[1]);
            qty = parseInt(numMatch[2]) || qty;
            const extra = (numMatch[3] || '').toLowerCase();
            if (extra.includes('ke1') || extra.includes('1 dau') || extra.includes('1 đầu')) style = 'ke1';
            else if (extra.includes('ke') || extra.includes('2 dau') || extra.includes('2 đầu')) style = 'ke';

            const matMatch = extra.match(/(\d+)\s*(?:mm)?$/);
            if (matMatch) mat = parseInt(matMatch[1]) || mat;
          }
        }

        if (!name) name = str;
        if (!mat) mat = extractMatFromProfile(profile);

        if (length > 0) {
          newParts.push({
            id: makeId('p_' + i),
            name,
            profile,
            length,
            qty: qty || 1,
            style,
            mat,
            _autoDetected: !!(specs && specs.detectedProfile)
          });
        }
      });

      return newParts;
    }


// Expose on window
if (typeof window !== "undefined") {
  window.exportNestedBarIGES = exportNestedBarIGES;
  window.generateZaloText = generateZaloText;
  window.exportCSV = exportCSV;
  window.parseIGESFile = parseIGESFile;
  window.parsePasteInput = parsePasteInput;
}

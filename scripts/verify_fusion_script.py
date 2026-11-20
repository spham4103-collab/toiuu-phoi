"""
Automated verification suite for Xuat_IGS_Va_Toi_Uu_Phoi.py (Fusion 360 export script).
Mocks adsk.core and adsk.fusion in memory to test:
  - Python syntax / compilation
  - Pre-selection resolution (Occurrence, BRepBody, BRepFace, active sub-assembly fallback)
  - Recursive sub-assembly collection & individual occurrence collection
  - Parent + child overlap deduplication via fullPathName (zero double-counting)
  - Hierarchical visibility (occ.isLightBulbOn, occ.isVisible, bodies folder, body lightbulb, suppressed)
  - Non-tube filtering (Sheet Metal, fasteners/plates keywords, thin plate geometry) & skip log
  - Suggested project naming (1 parent Component, common direct parent, unrelated selection, Root)
  - Visibility snapshot + hide_all_for_isolated_export + try/finally restoration under normal & exception paths
  - Command dialog lifecycle (autoTerminate(False), InputChanged, ValidateInputs, Execute, Destroy -> terminate())
"""
import os
import sys
import math
import types
import py_compile
import importlib.util

ROOT_DIR = r"C:\Users\Administrator\toiuu-phoi"
SCRIPT_PATH = os.path.join(ROOT_DIR, "Xuat_IGS_Va_Toi_Uu_Phoi.py")


def build_mock_adsk():
    state = {"auto_terminate": None, "terminated": False}

    adsk_mod = types.ModuleType("adsk")
    core_mod = types.ModuleType("adsk.core")
    fusion_mod = types.ModuleType("adsk.fusion")

    def autoTerminate(val):
        state["auto_terminate"] = bool(val)

    def terminate():
        state["terminated"] = True

    adsk_mod.autoTerminate = autoTerminate
    adsk_mod.terminate = terminate
    adsk_mod.core = core_mod
    adsk_mod.fusion = fusion_mod

    class BaseCollection:
        def __init__(self, items=None):
            self._items = list(items or [])

        @property
        def count(self):
            return len(self._items)

        def item(self, idx):
            return self._items[idx]

        def append(self, obj):
            self._items.append(obj)

    class SurfaceTypes:
        PlaneSurfaceType = 0
        CylinderSurfaceType = 1

    class DialogResults:
        DialogOK = 1
        DialogYes = 2
        DialogNo = 3
        DialogCancel = 4

    class MessageBoxButtonTypes:
        YesNoButtonType = 1

    class MessageBoxIconTypes:
        QuestionIconType = 2

    class DesignTypes:
        ParametricDesignType = 1
        DirectDesignType = 0

    class Point3D:
        def __init__(self, x=0.0, y=0.0, z=0.0):
            self.x, self.y, self.z = float(x), float(y), float(z)

        @staticmethod
        def create(x=0.0, y=0.0, z=0.0):
            return Point3D(x, y, z)

    class Vector3D:
        def __init__(self, x=0.0, y=0.0, z=0.0):
            self.x, self.y, self.z = float(x), float(y), float(z)

        @staticmethod
        def create(x=0.0, y=0.0, z=0.0):
            return Vector3D(x, y, z)

    class Matrix3D:
        def __init__(self):
            self.translation = Vector3D(0, 0, 0)
            self._m = [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]

        @staticmethod
        def create():
            return Matrix3D()

        def setCell(self, r, c, val):
            self._m[r][c] = float(val)

        def getCell(self, r, c):
            return self._m[r][c]

        def setWithCoordinateSystem(self, origin, xDir, yDir, zDir):
            self._m[0][0] = xDir.x; self._m[0][1] = yDir.x; self._m[0][2] = zDir.x; self._m[0][3] = origin.x
            self._m[1][0] = xDir.y; self._m[1][1] = yDir.y; self._m[1][2] = zDir.y; self._m[1][3] = origin.y
            self._m[2][0] = xDir.z; self._m[2][1] = yDir.z; self._m[2][2] = zDir.z; self._m[2][3] = origin.z
            self._m[3][0] = 0.0;    self._m[3][1] = 0.0;    self._m[3][2] = 0.0;    self._m[3][3] = 1.0

        def invert(self):
            R = [[self._m[r][c] for c in range(3)] for r in range(3)]
            T = [self._m[r][3] for r in range(3)]
            R_inv = [[R[c][r] for c in range(3)] for r in range(3)]
            T_inv = [-(R_inv[r][0] * T[0] + R_inv[r][1] * T[1] + R_inv[r][2] * T[2]) for r in range(3)]
            for r in range(3):
                for c in range(3):
                    self._m[r][c] = R_inv[r][c]
                self._m[r][3] = T_inv[r]

        def setToRotation(self, angle, axis, origin=None):
            l = math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z) or 1.0
            ux, uy, uz = axis.x / l, axis.y / l, axis.z / l
            cos_a = math.cos(angle)
            sin_a = math.sin(angle)
            one_c = 1.0 - cos_a
            self._m[0][0] = cos_a + ux * ux * one_c
            self._m[0][1] = ux * uy * one_c - uz * sin_a
            self._m[0][2] = ux * uz * one_c + uy * sin_a
            self._m[1][0] = uy * ux * one_c + uz * sin_a
            self._m[1][1] = cos_a + uy * uy * one_c
            self._m[1][2] = uy * uz * one_c - ux * sin_a
            self._m[2][0] = uz * ux * one_c - uy * sin_a
            self._m[2][1] = uz * uy * one_c + ux * sin_a
            self._m[2][2] = cos_a + uz * uz * one_c
            self._m[0][3] = self._m[1][3] = self._m[2][3] = 0.0
            self._m[3][0] = self._m[3][1] = self._m[3][2] = 0.0
            self._m[3][3] = 1.0

        def transformPoint(self, pt):
            tx = getattr(self.translation, 'x', 0.0)
            ty = getattr(self.translation, 'y', 0.0)
            tz = getattr(self.translation, 'z', 0.0)
            x = self._m[0][0] * pt.x + self._m[0][1] * pt.y + self._m[0][2] * pt.z + self._m[0][3] + tx
            y = self._m[1][0] * pt.x + self._m[1][1] * pt.y + self._m[1][2] * pt.z + self._m[1][3] + ty
            z = self._m[2][0] * pt.x + self._m[2][1] * pt.y + self._m[2][2] * pt.z + self._m[2][3] + tz
            return Point3D(x, y, z)

        def transformVector(self, v):
            x = self._m[0][0] * v.x + self._m[0][1] * v.y + self._m[0][2] * v.z
            y = self._m[1][0] * v.x + self._m[1][1] * v.y + self._m[1][2] * v.z
            z = self._m[2][0] * v.x + self._m[2][1] * v.y + self._m[2][2] * v.z
            return Vector3D(x, y, z)

    class BoundingBox3D:
        def __init__(self, min_pt, max_pt):
            self.minPoint = min_pt
            self.maxPoint = max_pt

    class BaseEventHandler:
        pass

    class BaseInput:
        def __init__(self, inp_id):
            self.id = inp_id
            self.isVisible = True
            self.isEnabled = True

    class MockRadioItem:
        def __init__(self, name, is_sel=False):
            self.name = name
            self.isSelected = is_sel

    class MockRadioList:
        def __init__(self):
            self._items = []

        def add(self, name, is_sel=False):
            it = MockRadioItem(name, is_sel)
            self._items.append(it)
            return it

        @property
        def count(self):
            return len(self._items)

        def item(self, i):
            return self._items[i]

    class RadioButtonGroupCommandInput(BaseInput):
        def __init__(self, inp_id):
            super().__init__(inp_id)
            self.listItems = MockRadioList()

        @property
        def selectedItem(self):
            for it in self.listItems._items:
                if it.isSelected:
                    return it
            return None

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, RadioButtonGroupCommandInput) else None

    class MockSelectionObj:
        def __init__(self, entity):
            self.entity = entity

    class SelectionCommandInput(BaseInput):
        def __init__(self, inp_id):
            super().__init__(inp_id)
            self._sels = []
            self.filters = []
            self.limits = (0, 0)

        def addSelectionFilter(self, f):
            self.filters.append(f)

        def setSelectionLimits(self, mn, mx):
            self.limits = (mn, mx)

        def addSelection(self, ent):
            self._sels.append(MockSelectionObj(ent))

        @property
        def selectionCount(self):
            return len(self._sels)

        def selection(self, i):
            return self._sels[i]

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, SelectionCommandInput) else None

    class BoolValueCommandInput(BaseInput):
        def __init__(self, inp_id, val=True):
            super().__init__(inp_id)
            self.value = val

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, BoolValueCommandInput) else None

    class StringValueCommandInput(BaseInput):
        def __init__(self, inp_id, val=""):
            super().__init__(inp_id)
            self.value = val

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, StringValueCommandInput) else None

    class TextBoxCommandInput(BaseInput):
        def __init__(self, inp_id, html=""):
            super().__init__(inp_id)
            self.formattedText = html

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, TextBoxCommandInput) else None

    class MockCommandInputs:
        def __init__(self):
            self._map = {}

        def addRadioButtonGroupCommandInput(self, inp_id, _name):
            obj = RadioButtonGroupCommandInput(inp_id)
            self._map[inp_id] = obj
            return obj

        def addSelectionInput(self, inp_id, _name, _prompt):
            obj = SelectionCommandInput(inp_id)
            self._map[inp_id] = obj
            return obj

        def addBoolValueInput(self, inp_id, _name, _cb, _res, val):
            obj = BoolValueCommandInput(inp_id, val)
            self._map[inp_id] = obj
            return obj

        def addStringValueInput(self, inp_id, _name, val):
            obj = StringValueCommandInput(inp_id, val)
            self._map[inp_id] = obj
            return obj

        def addTextBoxCommandInput(self, inp_id, _name, html, _rows, _ro):
            obj = TextBoxCommandInput(inp_id, html)
            self._map[inp_id] = obj
            return obj

        def itemById(self, inp_id):
            return self._map.get(inp_id)

    class MockEvent:
        def __init__(self):
            self.handlers = []

        def add(self, h):
            self.handlers.append(h)

    class MockCommand:
        def __init__(self):
            self.commandInputs = MockCommandInputs()
            self.inputChanged = MockEvent()
            self.validateInputs = MockEvent()
            self.execute = MockEvent()
            self.destroy = MockEvent()
            self.isExecutedWhenPreEmpted = True
            self.okButtonText = "OK"

        def setDialogMinimumSize(self, *_a):
            pass

        def setDialogInitialSize(self, *_a):
            pass

    class MockCmdDef:
        def __init__(self, cmd_id, name, tip):
            self.id = cmd_id
            self.name = name
            self.tooltip = tip
            self.commandCreated = MockEvent()
            self.last_command = None
            self.deleted = False

        def execute(self):
            cmd = MockCommand()
            self.last_command = cmd
            args = types.SimpleNamespace(command=cmd)
            for h in list(self.commandCreated.handlers):
                h.notify(args)

        def deleteMe(self):
            self.deleted = True

    class MockCmdDefs:
        def __init__(self):
            self._defs = {}

        def itemById(self, cid):
            return self._defs.get(cid)

        def addButtonDefinition(self, cid, name, tip):
            d = MockCmdDef(cid, name, tip)
            self._defs[cid] = d
            return d

    class MockUI:
        def __init__(self, active_sels=None):
            self.commandDefinitions = MockCmdDefs()
            self.activeSelections = BaseCollection(active_sels or [])
            self.messages = []

        def messageBox(self, msg, title="", *_a):
            self.messages.append((title, msg))
            return DialogResults.DialogNo

    class MockFace:
        def __init__(self, body, normal=None, area=1.0, point_on_face=None, surface_type=0):
            self.body = body
            self.normal = normal or Vector3D(0, 0, 1)
            self.area = float(area)
            self.pointOnFace = point_on_face or Point3D(0, 0, 0)
            self.geometry = types.SimpleNamespace(
                surfaceType=surface_type,
                axis=self.normal if surface_type == SurfaceTypes.CylinderSurfaceType else None
            )
            self.evaluator = types.SimpleNamespace(
                getNormalAtPoint=lambda pt: (True, self.normal)
            )
            self.boundingBox = BoundingBox3D(Point3D(-1, -1, -1), Point3D(1, 1, 1))

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, MockFace) else None

    class MockBody:
        def __init__(self, name, dx_cm, dy_cm, dz_cm, *, is_light=True, is_visible=True, is_sheet=False, asm_ctx=None, native=None, vertices=None, faces=None):
            self.name = name
            self.isLightBulbOn = is_light
            self.isVisible = is_visible
            self.isSheetMetal = is_sheet
            self.assemblyContext = asm_ctx
            self.nativeObject = native or self
            self.dx_cm = dx_cm
            self.dy_cm = dy_cm
            self.dz_cm = dz_cm

            if vertices is not None:
                self.vertices = [Point3D(v.x, v.y, v.z) for v in vertices]
            else:
                self.vertices = [
                    Point3D(x, y, z)
                    for x in [0.0, dx_cm]
                    for y in [0.0, dy_cm]
                    for z in [0.0, dz_cm]
                ]

            self._recompute_bounding_box()

            if faces is not None:
                self.faces = faces
            else:
                self.faces = []
                self._build_default_faces(dx_cm, dy_cm, dz_cm)

        def _recompute_bounding_box(self):
            if self.vertices:
                xs = [v.x for v in self.vertices]
                ys = [v.y for v in self.vertices]
                zs = [v.z for v in self.vertices]
                self.boundingBox = BoundingBox3D(
                    Point3D(min(xs), min(ys), min(zs)),
                    Point3D(max(xs), max(ys), max(zs))
                )
            else:
                self.boundingBox = BoundingBox3D(Point3D(0, 0, 0), Point3D(self.dx_cm, self.dy_cm, self.dz_cm))

        def _build_default_faces(self, w, h, l):
            f_x_neg = MockFace(self, Vector3D(-1, 0, 0), h * l, Point3D(0, h / 2.0, l / 2.0))
            f_x_pos = MockFace(self, Vector3D(1, 0, 0), h * l, Point3D(w, h / 2.0, l / 2.0))
            f_y_neg = MockFace(self, Vector3D(0, -1, 0), w * l, Point3D(w / 2.0, 0, l / 2.0))
            f_y_pos = MockFace(self, Vector3D(0, 1, 0), w * l, Point3D(w / 2.0, h, l / 2.0))
            f_z_neg = MockFace(self, Vector3D(0, 0, -1), w * h, Point3D(w / 2.0, h / 2.0, 0))
            f_z_pos = MockFace(self, Vector3D(0, 0, 1), w * h, Point3D(w / 2.0, h / 2.0, l))
            self.faces = [f_x_neg, f_x_pos, f_y_neg, f_y_pos, f_z_neg, f_z_pos]

        def clone(self):
            new_faces = []
            new_b = MockBody(
                self.name,
                self.dx_cm, self.dy_cm, self.dz_cm,
                is_light=self.isLightBulbOn,
                is_visible=self.isVisible,
                is_sheet=self.isSheetMetal,
                asm_ctx=self.assemblyContext,
                native=self.nativeObject,
                vertices=self.vertices,
                faces=[]
            )
            for f in self.faces:
                new_f = MockFace(new_b, Vector3D(f.normal.x, f.normal.y, f.normal.z), f.area, Point3D(f.pointOnFace.x, f.pointOnFace.y, f.pointOnFace.z), f.geometry.surfaceType)
                new_faces.append(new_f)
            new_b.faces = new_faces
            return new_b

        def applyTransform(self, mat):
            self.vertices = [mat.transformPoint(v) for v in self.vertices]
            self._recompute_bounding_box()
            for f in self.faces:
                f.normal = mat.transformVector(f.normal)
                f.pointOnFace = mat.transformPoint(f.pointOnFace)
                f.geometry.axis = f.normal if f.geometry.surfaceType == SurfaceTypes.CylinderSurfaceType else None

        def createForAssemblyContext(self, occ):
            b = self.clone()
            b.assemblyContext = occ
            b.nativeObject = self
            return b

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, MockBody) else None

    class MockEdge:
        def __init__(self, body):
            self.body = body

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, MockEdge) else None

    class MockComponent:
        def __init__(self, name, bodies=None, folder_on=True):
            self.name = name
            self.bRepBodies = BaseCollection(bodies or [])
            self.isBodiesFolderLightBulbOn = folder_on

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, MockComponent) else None

    class MockOccurrence:
        def __init__(self, name, comp, full_path, parent_occ=None, is_light=True, is_visible=True, is_suppressed=False):
            self.name = name
            self.component = comp
            self.fullPathName = full_path
            self.assemblyContext = parent_occ
            self.isLightBulbOn = is_light
            self.isVisible = is_visible
            self.isSuppressed = is_suppressed
            self.childOccurrences = BaseCollection([])
            self.bRepBodies = None
            self.activated = False

        def activate(self):
            self.activated = True

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, MockOccurrence) else None

    class MockRoot(MockComponent):
        def __init__(self, name="Root", bodies=None, occs=None):
            super().__init__(name, bodies=bodies)
            self.occurrences = BaseCollection(occs or [])
            self.allOccurrences = BaseCollection([])

    class MockDesign:
        def __init__(self, root, active_occ=None):
            self.rootComponent = root
            self.activeComponent = active_occ.component if active_occ else root
            self.activeOccurrence = active_occ
            self.exportManager = types.SimpleNamespace()
            self.designType = DesignTypes.ParametricDesignType

        def activateRootComponent(self):
            self.activeComponent = self.rootComponent
            self.activeOccurrence = None

        @staticmethod
        def cast(obj):
            return obj if isinstance(obj, MockDesign) else None

    class MockTempBRepManager:
        @staticmethod
        def get():
            class TBM:
                @staticmethod
                def copy(b):
                    return b.clone() if hasattr(b, 'clone') else b
                @staticmethod
                def transform(b, m):
                    if hasattr(b, 'applyTransform'):
                        b.applyTransform(m)
            return TBM()

    class MockApp:
        _inst = None

        def __init__(self, ui, doc, des):
            self.userInterface = ui
            self.activeDocument = doc
            self.activeProduct = des

        @staticmethod
        def get():
            return MockApp._inst

    core_mod.Application = MockApp
    core_mod.SurfaceTypes = SurfaceTypes
    core_mod.DialogResults = DialogResults
    core_mod.MessageBoxButtonTypes = MessageBoxButtonTypes
    core_mod.MessageBoxIconTypes = MessageBoxIconTypes
    core_mod.Point3D = Point3D
    core_mod.Vector3D = Vector3D
    core_mod.Matrix3D = Matrix3D
    core_mod.InputChangedEventHandler = BaseEventHandler
    core_mod.ValidateInputsEventHandler = BaseEventHandler
    core_mod.CommandEventHandler = BaseEventHandler
    core_mod.CommandCreatedEventHandler = BaseEventHandler
    core_mod.RadioButtonGroupCommandInput = RadioButtonGroupCommandInput
    core_mod.SelectionCommandInput = SelectionCommandInput
    core_mod.BoolValueCommandInput = BoolValueCommandInput
    core_mod.StringValueCommandInput = StringValueCommandInput
    core_mod.TextBoxCommandInput = TextBoxCommandInput

    fusion_mod.Design = MockDesign
    fusion_mod.DesignTypes = DesignTypes
    fusion_mod.TemporaryBRepManager = MockTempBRepManager
    fusion_mod.Occurrence = MockOccurrence
    fusion_mod.BRepBody = MockBody
    fusion_mod.BRepFace = MockFace
    fusion_mod.BRepEdge = MockEdge
    fusion_mod.Component = MockComponent

    return adsk_mod, core_mod, fusion_mod, state


def load_script_module(adsk_mod, core_mod, fusion_mod):
    sys.modules["adsk"] = adsk_mod
    sys.modules["adsk.core"] = core_mod
    sys.modules["adsk.fusion"] = fusion_mod
    spec = importlib.util.spec_from_file_location("xuat_igs_mod", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_sample_tree(core_mod, fusion_mod):
    MockBody = fusion_mod.BRepBody
    MockComp = fusion_mod.Component
    MockOcc = fusion_mod.MockOccurrence if hasattr(fusion_mod, "MockOccurrence") else fusion_mod.Occurrence

    # Assembly structure:
    # Root
    #  ├─ Cum_Khung_Ban:1 (Parent Sub-assembly)
    #  │   ├─ Hop_30x30x1.8_L1200:1 (tube body 3x3x120 cm)
    #  │   ├─ Hop_30x30x1.8_L800:1 (tube body 3x3x80 cm)
    #  │   ├─ Mat_Ban_Ton:1 (SheetMetal thin plate, MUST BE FILTERED OUT)
    #  │   ├─ Bulong_M8:1 (keyword 'bulong', MUST BE FILTERED OUT)
    #  │   ├─ Thanh_An_TatDen:1 (isLightBulbOn=False, MUST BE SKIPPED)
    #  │   └─ Thanh_Suppressed:1 (isSuppressed=True, MUST BE SKIPPED)
    #  └─ Cum_Chan_Ke:1 (Second Sub-assembly)
    #      ├─ Hop_40x40x1.8_L750:1 (tube body 4x4x75 cm)
    #      └─ folder_hidden_pipe:1 (bodies folder off -> MUST BE SKIPPED)
    b_t1 = MockBody("Body1", 3.0, 3.0, 120.0)
    c_t1 = MockComp("Hộp 30x30x1.8 L1200", [b_t1])

    b_t2 = MockBody("Body1", 3.0, 3.0, 80.0)
    c_t2 = MockComp("Hộp 30x30x1.8 L800", [b_t2])

    b_sheet = MockBody("Sheet", 80.0, 60.0, 0.2, is_sheet=True)
    c_sheet = MockComp("Tấm mặt bàn 1.5mm", [b_sheet])

    b_bolt = MockBody("Bolt", 1.2, 1.2, 4.0)
    c_bolt = MockComp("Bulong M8x40", [b_bolt])

    b_hid = MockBody("Body1", 3.0, 3.0, 50.0)
    c_hid = MockComp("Hộp 30x30x1.8 L500", [b_hid])

    b_sup = MockBody("Body1", 3.0, 3.0, 60.0)
    c_sup = MockComp("Hộp 30x30x1.8 L600", [b_sup])

    b_leg = MockBody("Body1", 4.0, 4.0, 75.0)
    c_leg = MockComp("Hộp 40x40x1.8 L750", [b_leg])

    b_fhid = MockBody("Body1", 4.0, 4.0, 60.0)
    c_fhid = MockComp("Hộp 40x40x1.8 L600", [b_fhid], folder_on=False)

    b_temp = MockBody("Body1", 3.0, 3.0, 600.0)
    c_temp = MockComp("Cay_A_Hop_30x30", [b_temp])

    c_parent_1 = MockComp("Khung_Ban_Chinh")
    occ_p1 = MockOcc("Khung_Ban_Chinh:1", c_parent_1, "Khung_Ban_Chinh:1")
    occ_t1 = MockOcc("Hộp 30x30x1.8 L1200:1", c_t1, "Khung_Ban_Chinh:1+Hộp 30x30x1.8 L1200:1", parent_occ=occ_p1)
    occ_t2 = MockOcc("Hộp 30x30x1.8 L800:1", c_t2, "Khung_Ban_Chinh:1+Hộp 30x30x1.8 L800:1", parent_occ=occ_p1)
    occ_sheet = MockOcc("Tấm mặt bàn 1.5mm:1", c_sheet, "Khung_Ban_Chinh:1+Tấm mặt bàn 1.5mm:1", parent_occ=occ_p1)
    occ_bolt = MockOcc("Bulong M8x40:1", c_bolt, "Khung_Ban_Chinh:1+Bulong M8x40:1", parent_occ=occ_p1)
    occ_hid = MockOcc("Thanh_An:1", c_hid, "Khung_Ban_Chinh:1+Thanh_An:1", parent_occ=occ_p1, is_light=False)
    occ_sup = MockOcc("Thanh_Sup:1", c_sup, "Khung_Ban_Chinh:1+Thanh_Sup:1", parent_occ=occ_p1, is_suppressed=True)
    for ch in [occ_t1, occ_t2, occ_sheet, occ_bolt, occ_hid, occ_sup]:
        occ_p1.childOccurrences.append(ch)

    c_parent_2 = MockComp("Cum_Chan_Ke")
    occ_p2 = MockOcc("Cum_Chan_Ke:1", c_parent_2, "Cum_Chan_Ke:1")
    occ_leg = MockOcc("Hộp 40x40x1.8 L750:1", c_leg, "Cum_Chan_Ke:1+Hộp 40x40x1.8 L750:1", parent_occ=occ_p2)
    occ_fhid = MockOcc("FolderHidden:1", c_fhid, "Cum_Chan_Ke:1+FolderHidden:1", parent_occ=occ_p2)
    for ch in [occ_leg, occ_fhid]:
        occ_p2.childOccurrences.append(ch)

    occ_temp = MockOcc("Cay_A_Hop_30x30:1", c_temp, "Cay_A_Hop_30x30:1")

    root = types.SimpleNamespace(
        name="RootComponent",
        isBodiesFolderLightBulbOn=True,
        bRepBodies=types.SimpleNamespace(count=0, item=lambda i: None),
        occurrences=types.SimpleNamespace(count=3, item=lambda i: [occ_p1, occ_p2, occ_temp][i]),
        allOccurrences=types.SimpleNamespace(
            count=11,
            item=lambda i: [occ_p1, occ_t1, occ_t2, occ_sheet, occ_bolt, occ_hid, occ_sup, occ_p2, occ_leg, occ_fhid, occ_temp][i]
        )
    )
    return root, {
        "occ_p1": occ_p1, "occ_t1": occ_t1, "occ_t2": occ_t2,
        "occ_sheet": occ_sheet, "occ_bolt": occ_bolt, "occ_hid": occ_hid, "occ_sup": occ_sup,
        "occ_p2": occ_p2, "occ_leg": occ_leg, "occ_fhid": occ_fhid, "occ_temp": occ_temp,
        "b_t1": b_t1, "b_t2": b_t2, "b_leg": b_leg
    }


def main():
    py_compile.compile(SCRIPT_PATH, doraise=True)
    print("[OK] py_compile passed for Xuat_IGS_Va_Toi_Uu_Phoi.py")

    adsk_mod, core_mod, fusion_mod, state = build_mock_adsk()
    mod = load_script_module(adsk_mod, core_mod, fusion_mod)
    root, refs = build_sample_tree(core_mod, fusion_mod)

    # 1. Parent + Child Deduplication + Visibility + Non-tube filter
    entries, skipped, stats = mod.collect_scoped_candidates(
        root,
        [refs["occ_t1"], refs["occ_p1"]],  # Deliberately pass child FIRST then parent!
        use_root_mode=False,
        skip_hidden=True
    )
    valid_after_filter = []
    for ent in entries:
        ok, reason = mod.classify_candidate_filter(ent["local_body"], ent["proxy_body"], ent["name_hint"])
        if ok:
            valid_after_filter.append(ent)
        else:
            skipped.append({"name": ent["name_hint"], "reason": reason, "kind": "non_tube"})

    assert len(valid_after_filter) == 2, f"Expected exactly 2 deduplicated tubes in Khung_Ban_Chinh, got {len(valid_after_filter)}"
    paths = [e["full_path"] for e in valid_after_filter]
    assert len(set(paths)) == 2, "Duplicate body paths leaked!"
    assert not any("40x40" in e["name_hint"] for e in valid_after_filter), "Cum_Chan_Ke leaked into Khung_Ban_Chinh scope!"
    assert stats["hidden_or_suppressed"] == 2, f"Expected 2 hidden/suppressed skipped, got {stats['hidden_or_suppressed']}"
    assert len([s for s in skipped if s["kind"] == "non_tube"]) == 2, "SheetMetal & Bulong should be in skipped log"
    print("[OK] Sub-assembly recursive scope, parent+child deduplication, hidden/suppressed & non-tube filtering verified")

    # 2. Root mode vs Individual selection
    root_entries, root_skipped, _ = mod.collect_scoped_candidates(root, [], use_root_mode=True, skip_hidden=True)
    root_valid = [e for e in root_entries if mod.classify_candidate_filter(e["local_body"], e["proxy_body"], e["name_hint"])[0]]
    assert len(root_valid) == 3, f"Expected 3 visible tubes across Root (2 in p1 + 1 in p2), got {len(root_valid)}"
    assert any(s["kind"] == "temp" for s in root_skipped), "Temp Cay_* component should be skipped"

    ind_entries, _, _ = mod.collect_scoped_candidates(root, [refs["occ_t1"], refs["occ_leg"]], use_root_mode=False, skip_hidden=True)
    assert len(ind_entries) == 2, f"Individual selection of 2 tubes should yield 2 entries, got {len(ind_entries)}"
    print("[OK] Individual tube multi-selection & Root fallback verified")

    # 3. Pre-selection resolution (Occurrence + Face + Active Sub-assembly fallback)
    proxy_body_t1 = refs["b_t1"].createForAssemblyContext(refs["occ_t1"])
    face_t1 = fusion_mod.BRepFace(proxy_body_t1)
    ui_pre = core_mod.Application.get()  # not yet set
    mock_ui = types.SimpleNamespace(
        activeSelections=types.SimpleNamespace(
            count=2,
            item=lambda i: types.SimpleNamespace(entity=[refs["occ_p1"], face_t1][i])
        )
    )
    resolved = mod.resolve_preselected_occurrences(mock_ui, root, None)
    assert len(resolved) == 2, "Preselection should resolve Occurrence + Face's assemblyContext"

    des_sub = fusion_mod.Design(root, active_occ=refs["occ_p2"])
    mock_ui_empty = types.SimpleNamespace(activeSelections=types.SimpleNamespace(count=0))
    resolved_fallback = mod.resolve_preselected_occurrences(mock_ui_empty, root, des_sub)
    assert len(resolved_fallback) == 1 and resolved_fallback[0] == refs["occ_p2"], "Empty selection should fall back to active sub-assembly"
    print("[OK] Pre-selection (Occurrence/Face + active sub-assembly fallback) verified")

    # 4. Suggest project name
    assert mod.suggest_project_name([refs["occ_p1"]], "FileTong_v3", False) == "Khung_Ban_Chinh"
    assert mod.suggest_project_name([refs["occ_t1"], refs["occ_t2"]], "FileTong_v3", False) == "Khung_Ban_Chinh"
    assert mod.suggest_project_name([refs["occ_p1"], refs["occ_p2"]], "FileTong_v3", False) == "FileTong_v3 (2 cụm chọn)"
    assert mod.suggest_project_name([refs["occ_p1"]], "FileTong_v3", True) == "FileTong_v3"
    print("[OK] Auto project naming from parent component verified")

    # 5. Visibility snapshot + isolated hide + try/finally restore even on mid-export crash
    assert refs["occ_p1"].isLightBulbOn is True
    assert refs["occ_hid"].isLightBulbOn is False
    des_live = fusion_mod.Design(root, active_occ=refs["occ_p2"])
    snap = mod.snapshot_visibility_state(root, des_live)
    try:
        des_live.activateRootComponent()
        mod.hide_all_for_isolated_export(root)
        assert refs["occ_p1"].isLightBulbOn is False, "Top occurrence should be hidden during isolated export"
        assert refs["occ_p2"].isLightBulbOn is False
        raise RuntimeError("Simulated mid-export crash")
    except RuntimeError:
        pass
    finally:
        mod.restore_visibility_state(snap)

    assert refs["occ_p1"].isLightBulbOn is True, "occ_p1 visibility must be restored after exception"
    assert refs["occ_p2"].isLightBulbOn is True, "occ_p2 visibility must be restored after exception"
    assert refs["occ_hid"].isLightBulbOn is False, "Hidden child must stay hidden after restore"
    assert refs["occ_p2"].activated is True, "Previous active sub-assembly must be reactivated"
    print("[OK] Isolated export + try/finally visibility restoration verified")

    # 6. Command dialog lifecycle test
    doc = types.SimpleNamespace(name="Ban_Thao_Tac_Tong")
    des_cmd = fusion_mod.Design(root, active_occ=None)
    ui_cmd = mock_ui_empty
    ui_cmd = core_mod  # placeholder replaced below
    # Use MockUI via helper
    cmd_ui_sels = [types.SimpleNamespace(entity=refs["occ_p1"])]
    # Access MockUI from adsk core test run
    core_mod.Application._inst = types.SimpleNamespace(
        userInterface=None,
        activeDocument=doc,
        activeProduct=des_cmd
    )
    # Build real MockUI cleanly by calling run with simple MockUI
    class _UIWrap:
        def __init__(self):
            class _Defs:
                def __init__(self): self.m = {}
                def itemById(self, i): return self.m.get(i)
                def addButtonDefinition(self, i, n, t):
                    d = types.SimpleNamespace(
                        id=i, commandCreated=types.SimpleNamespace(handlers=[], add=lambda h: d.commandCreated.handlers.append(h)),
                        deleted=False, deleteMe=lambda: setattr(d, "deleted", True)
                    )
                    def _exec():
                        cmd = types.SimpleNamespace(
                            isExecutedWhenPreEmpted=True, okButtonText="",
                            commandInputs=core_mod.TextBoxCommandInput.__mro__[1] if False else None,
                            setDialogMinimumSize=lambda *a: None, setDialogInitialSize=lambda *a: None,
                            inputChanged=types.SimpleNamespace(handlers=[], add=lambda h: cmd.inputChanged.handlers.append(h)),
                            validateInputs=types.SimpleNamespace(handlers=[], add=lambda h: cmd.validateInputs.handlers.append(h)),
                            execute=types.SimpleNamespace(handlers=[], add=lambda h: cmd.execute.handlers.append(h)),
                            destroy=types.SimpleNamespace(handlers=[], add=lambda h: cmd.destroy.handlers.append(h)),
                        )
                        # Build MockCommandInputs from core_mod classes
                        inps_map = {}
                        cmd.commandInputs = types.SimpleNamespace(
                            addRadioButtonGroupCommandInput=lambda iid, _n: inps_map.setdefault(iid, core_mod.RadioButtonGroupCommandInput(iid)),
                            addSelectionInput=lambda iid, _n, _t: inps_map.setdefault(iid, core_mod.SelectionCommandInput(iid)),
                            addBoolValueInput=lambda iid, _n, _c, _r, v: inps_map.setdefault(iid, core_mod.BoolValueCommandInput(iid, v)),
                            addStringValueInput=lambda iid, _n, v: inps_map.setdefault(iid, core_mod.StringValueCommandInput(iid, v)),
                            addTextBoxCommandInput=lambda iid, _n, h, _rows, _ro: inps_map.setdefault(iid, core_mod.TextBoxCommandInput(iid, h)),
                            itemById=lambda iid: inps_map.get(iid)
                        )
                        d.last_cmd = cmd
                        for h in list(d.commandCreated.handlers):
                            h.notify(types.SimpleNamespace(command=cmd))
                    d.execute = _exec
                    self.m[i] = d
                    return d
            self.commandDefinitions = _Defs()
            self.activeSelections = types.SimpleNamespace(count=1, item=lambda _i: types.SimpleNamespace(entity=refs["occ_p1"]))
            self.msgs = []
        def messageBox(self, m, t="", *_a):
            self.msgs.append((t, m))
            return core_mod.DialogResults.DialogNo

    wui = _UIWrap()
    core_mod.Application._inst.userInterface = wui
    mod.run(None)
    assert state["auto_terminate"] is False, "run() must call adsk.autoTerminate(False) for interactive command"
    cmd_def = wui.commandDefinitions.itemById(mod.CMD_ID)
    assert cmd_def is not None and cmd_def.last_cmd is not None
    c_inps = cmd_def.last_cmd.commandInputs
    assert c_inps.itemById("target_selection").selectionCount == 1, "Pre-selected parent should be auto-added"
    assert c_inps.itemById("project_name").value == "Khung_Ban_Chinh"
    # ValidateInputs check
    val_args = types.SimpleNamespace(inputs=c_inps, areInputsValid=False)
    cmd_def.last_cmd.validateInputs.handlers[0].notify(val_args)
    assert val_args.areInputsValid is True
    # Destroy cleans up definition and terminates cleanly
    cmd_def.last_cmd.destroy.handlers[0].notify(types.SimpleNamespace())
    assert cmd_def.deleted is True
    assert state["terminated"] is True
    print("[OK] Fusion Command Dialog lifecycle (pre-selection, validation, autoTerminate/terminate) verified")

    # 7. Strictly IGS export directory verification (No web/json/config files in export dir)
    import tempfile
    import shutil
    test_export_dir = os.path.join(tempfile.gettempdir(), "test_fusion_strictly_igs")
    os.makedirs(test_export_dir, exist_ok=True)
    try:
        # Create dummy mixed files in export directory
        with open(os.path.join(test_export_dir, "Cay_A_Hop_30x30.igs"), "w") as f: f.write("IGS DATA")
        with open(os.path.join(test_export_dir, "Thanh_ngang.igs"), "w") as f: f.write("IGS DATA")
        with open(os.path.join(test_export_dir, "index.html"), "w") as f: f.write("HTML DATA")
        with open(os.path.join(test_export_dir, "fusion_exported_project.json"), "w") as f: f.write("{}")
        with open(os.path.join(test_export_dir, "skipped_items_log.txt"), "w") as f: f.write("LOG")
        with open(os.path.join(test_export_dir, "logo_an_binh.jpg"), "w") as f: f.write("JPG")
        with open(os.path.join(test_export_dir, "toi-uu-engine.js"), "w") as f: f.write("JS")
        os.makedirs(os.path.join(test_export_dir, "css"), exist_ok=True)
        os.makedirs(os.path.join(test_export_dir, "js"), exist_ok=True)

        # Run clean_export_directory_strictly_igs without removing existing IGS
        assert hasattr(mod, "clean_export_directory_strictly_igs"), "Script must define clean_export_directory_strictly_igs"
        mod.clean_export_directory_strictly_igs(test_export_dir, remove_existing_igs=False)

        remaining = os.listdir(test_export_dir)
        assert len(remaining) == 2, f"Export dir must contain only 2 IGS files, found: {remaining}"
        assert all(f.lower().endswith(".igs") for f in remaining), f"All files must be .igs, found: {remaining}"
        print("[OK] Strictly .IGS output directory verification passed (all web/json/config files removed)")
    finally:
        shutil.rmtree(test_export_dir, ignore_errors=True)

    # 8. Local/Oriented Bounding Box (OBB) & 3D Rotated Diagonal Tube Recovery
    # Mô phỏng thanh Hộp 25x25x1 L242 bị xoay xiên 3D:
    # Ban đầu trong không gian cụm lắp ráp, góc nghiêng tạo ra World AABB dx=154mm, dy=25mm, dz=186mm
    # gây lỗi nhận diện nhầm ra Hộp 154x25x1 trong phiên bản cũ.
    import math

    tbm = fusion_mod.TemporaryBRepManager.get()

    # 8A. Thanh Hộp 25x25 L242 bị xoay quanh trục Y góc theta = 33.38 độ (tạo ra World AABB dx đúng 154.0mm)
    body_25_diag = fusion_mod.BRepBody("Thanh_Giang_Cheo_25x25_L242", 2.5, 2.5, 24.2)
    rot_y = core_mod.Matrix3D.create()
    theta_y = math.radians(33.38)
    rot_y.setToRotation(theta_y, core_mod.Vector3D.create(0, 1, 0))
    body_25_diag.applyTransform(rot_y)

    # Kiểm chứng World AABB trước chuẩn hóa đã bị giãn cạnh dx lên 15.4cm (154mm)
    raw_dx = round((body_25_diag.boundingBox.maxPoint.x - body_25_diag.boundingBox.minPoint.x) * 10, 1)
    raw_dz = round((body_25_diag.boundingBox.maxPoint.z - body_25_diag.boundingBox.minPoint.z) * 10, 1)
    assert abs(raw_dx - 154.0) < 2.0, f"Simulated rotated body should have raw World AABB dx ~ 154mm, got {raw_dx}"
    assert raw_dz < 220.0, f"Simulated rotated body raw dz should be projected, got {raw_dz}"

    # Gọi normalize_body theo hệ trục cục bộ OBB
    norm_25 = mod.normalize_body(tbm, body_25_diag)
    bb_norm = norm_25.boundingBox
    w_norm = round((bb_norm.maxPoint.x - bb_norm.minPoint.x) * 10, 1)
    h_norm = round((bb_norm.maxPoint.y - bb_norm.minPoint.y) * 10, 1)
    l_norm = round((bb_norm.maxPoint.z - bb_norm.minPoint.z) * 10, 1)

    assert abs(w_norm - 25.0) < 0.2, f"Expected normalized width 25.0mm, got {w_norm}mm"
    assert abs(h_norm - 25.0) < 0.2, f"Expected normalized height 25.0mm, got {h_norm}mm"
    assert abs(l_norm - 242.0) < 0.5, f"Expected normalized length 242.0mm, got {l_norm}mm"

    # Nhận diện quy cách sau chuẩn hóa
    prof_diag = mod.detect_profile_name(norm_25, w_norm, h_norm, 1.0, "Thanh_Giang_Cheo_L242")
    assert prof_diag == "Hộp 25x25x1", f"Expected 'Hộp 25x25x1', but got '{prof_diag}'"
    print("[OK] Test 8A: 3D rotated diagonal tube (L242 rotated to 154mm World AABB) restored to exact Hộp 25x25x1 L242 via OBB")

    # 8B. Thanh Hộp 25x25x1 bị xoay góc kép 3D (35 độ quanh X và 25 độ quanh Y)
    body_compound = fusion_mod.BRepBody("Hop 25x25x1 L242", 2.5, 2.5, 24.2)
    rot_x = core_mod.Matrix3D.create()
    rot_x.setToRotation(math.radians(35), core_mod.Vector3D.create(1, 0, 0))
    body_compound.applyTransform(rot_x)
    body_compound.applyTransform(rot_y)

    norm_comp = mod.normalize_body(tbm, body_compound)
    bb_comp = norm_comp.boundingBox
    w_comp = round((bb_comp.maxPoint.x - bb_comp.minPoint.x) * 10, 1)
    h_comp = round((bb_comp.maxPoint.y - bb_comp.minPoint.y) * 10, 1)
    l_comp = round((bb_comp.maxPoint.z - bb_comp.minPoint.z) * 10, 1)

    assert abs(w_comp - 25.0) < 0.2 and abs(h_comp - 25.0) < 0.2, f"Compound 3D rotation recovery failed: {w_comp}x{h_comp}"
    assert abs(l_comp - 242.0) < 0.5, f"Compound length recovery failed: {l_comp}"
    print("[OK] Test 8B: Compound 3D rotation (Pitch 35° + Yaw 39°) restored to exact 25x25x242mm")

    # 8C. Bổ sung cơ chế đối chiếu ngược với tên Component (Chống lỗi dị biệt)
    spec_parsed = mod.extract_profile_spec_from_name("Hop 25x25x1 L242")
    assert spec_parsed is not None and spec_parsed["w"] == 25.0 and spec_parsed["h"] == 25.0 and spec_parsed["t"] == 1.0

    spec_round = mod.extract_profile_spec_from_name("Ống Ø27x1.4 L1500")
    assert spec_round is not None and spec_round["w"] == 27.0 and spec_round["is_round"] is True

    # Giả lập trường hợp kích thước đo hình học bị dị thường (154x25), đối chiếu ngược với tên để bảo toàn quy cách
    prof_protected = mod.detect_profile_name(None, 154.0, 25.0, 1.0, "Hop 25x25x1 L242")
    assert prof_protected == "Hộp 25x25x1", f"Expected name anti-anomaly protection to return 'Hộp 25x25x1', got '{prof_protected}'"
    print("[OK] Test 8C: Component name cross-check & anti-anomaly guard successfully protected Hộp 25x25x1")

    # 8D. Thanh xiên 45 độ không bị classify_candidate_filter loại nhầm
    body_45 = fusion_mod.BRepBody("Hop 25x25x1 L200", 2.5, 2.5, 20.0)
    rot_45 = core_mod.Matrix3D.create()
    rot_45.setToRotation(math.radians(45), core_mod.Vector3D.create(0, 1, 0))
    body_45.applyTransform(rot_45)
    ok_45, reason_45 = mod.classify_candidate_filter(body_45, body_45, "Hop 25x25x1 L200")
    assert ok_45 is True, f"45-degree diagonal tube was falsely rejected: {reason_45}"
    print("[OK] Test 8D: 45-degree diagonal tube immunity in classify_candidate_filter verified")


if __name__ == "__main__":
    main()

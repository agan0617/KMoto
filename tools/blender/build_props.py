"""KMoto 街景小物件（規格 6.3、9.1）：用 Blender 純程式建模，輸出 assets/props.glb。

用法：
  blender -b --factory-startup -P tools/blender/build_props.py -- [輸出路徑]
預設輸出 <repo>/assets/props.glb。

座標：這裡直接寫 Blender 座標（Z 朝上），匯出成 glTF（Y 朝上）時 Blender (x, y, z) → 遊戲 (x, z, −y)。
所以「面向馬路」＝遊戲 +Z ＝ Blender −Y；貼牆的東西背面放在 Blender +Y。
每個物件一個頂層節點，原點在底部中心。只用材質的 baseColor（沒有貼圖），主程式把材質色烘進頂點色。
發光部件另外拆成 <名稱>__glow 物件。
"""
import bpy
import math
import os
import random
import sys
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = argv[0] if argv else os.path.join(HERE, '..', '..', 'assets', 'props.glb')
OUT = os.path.abspath(OUT)

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(617)
PI = math.pi

# ---------------------------------------------------------------- 材質
_mats = {}


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def M(hexs, rough=0.7, metal=0.0, emit=0.0):
    key = (hexs, rough, metal, emit)
    if key in _mats:
        return _mats[key]
    h = hexs.lstrip('#')
    rgb = tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    m = bpy.data.materials.new(f'm_{h}_{int(rough * 100)}_{int(metal * 100)}{"_e" if emit else ""}')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


# ---------------------------------------------------------------- 零件
_parts = []


def _finish(ob, mat, bevel, bseg, smooth, sub, disp):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    if sub:
        m = ob.modifiers.new('Sub', 'SUBSURF')
        m.levels = sub
        m.render_levels = sub
    if bevel:
        m = ob.modifiers.new('Bevel', 'BEVEL')
        m.width = bevel
        m.segments = bseg
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(40)
        m.harden_normals = True
    if disp:
        tex = bpy.data.textures.new('n', 'CLOUDS')
        tex.noise_scale = disp[1]
        m = ob.modifiers.new('Disp', 'DISPLACE')
        m.texture = tex
        m.strength = disp[0]
        m.mid_level = 0.5
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if smooth == 'all':
        bpy.ops.object.shade_smooth()
    elif smooth:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth if isinstance(smooth, (int, float)) and smooth > 1 else 40))
    else:
        bpy.ops.object.shade_flat()
    _parts.append(ob)
    return ob


def P(prim, mat, loc=(0, 0, 0), rot=(0, 0, 0), size=(1, 1, 1), bevel=0.0, bseg=2, smooth=True, sub=0, disp=None, **kw):
    """size 是實際尺寸（公尺）。cube：(x,y,z) 全長；cyl/cone：(直徑x, 直徑y, 高)；sph/ico：(直徑x,y,z)。"""
    if prim == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif prim == 'cyl':
        bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get('v', 16), radius=0.5, depth=1, end_fill_type='NGON' if kw.get('cap', True) else 'NOTHING')
    elif prim == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=kw.get('v', 16), radius1=0.5, radius2=0.5 * kw.get('top', 0.0), depth=1)
    elif prim == 'sph':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get('seg', 16), ring_count=kw.get('ring', 8), radius=0.5)
    elif prim == 'ico':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kw.get('sd', 2), radius=0.5)
    elif prim == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=kw['R'], minor_radius=kw['r'], major_segments=kw.get('ms', 16), minor_segments=kw.get('mn', 6))
    elif prim == 'plane':
        bpy.ops.mesh.primitive_plane_add(size=1)
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.location = loc
    ob.rotation_euler = rot
    return _finish(ob, mat, bevel, bseg, smooth, sub, disp)


def mesh_part(name, verts, faces, mat, smooth=True, bevel=0.0, sub=0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return _finish(ob, mat, bevel, 2, smooth, sub, None)


def tube(points, r, mat, v=8, smooth=True):
    """沿折線做管子（彎臂、銅管）。points：Blender 座標的點列。"""
    cu = bpy.data.curves.new('tube', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = max(1, v // 4 - 1)
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (*p, 1)
    ob = bpy.data.objects.new('tube', cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.active_object
    return _finish(ob, mat, 0, 2, smooth, 0, None)


def arc(c, R, a0, a1, n, plane='YZ'):
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        if plane == 'YZ':
            pts.append((c[0], c[1] + R * math.cos(a), c[2] + R * math.sin(a)))
        else:
            pts.append((c[0] + R * math.cos(a), c[1], c[2] + R * math.sin(a)))
    return pts


TRIS = {}


def _ao(ob, kind):
    """頂點色當作簡易環境光遮蔽：貼地的部分暗一點；樹冠下半部暗、上半部亮（降低平塗感）。"""
    me = ob.data
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    rnd = random.Random(len(zs))
    if kind == 'tree':
        cb = z1 - (z1 - z0) * 0.45
        for i, v in enumerate(me.vertices):
            z = v.co.z
            if z < cb - 0.3:
                a = 0.8 + 0.2 * min(1, (z - z0) / 1.5)
            else:
                t = max(0.0, min(1.0, (z - (cb - 0.3)) / (z1 - cb + 0.3)))
                r = math.hypot(v.co.x, v.co.y)
                a = (0.5 + 0.5 * t ** 0.8) * (0.85 + 0.15 * min(1, r / 2.0)) + rnd.uniform(-0.05, 0.05)
            a = max(0.3, min(1.0, a))
            attr.data[i].color_srgb = (a, a, a, 1)
    else:
        for i, v in enumerate(me.vertices):
            a = 0.68 + 0.32 * min(1.0, (v.co.z - z0) / 0.6)
            attr.data[i].color_srgb = (a, a, a, 1)
    me.color_attributes.active_color = attr


def commit(name, glow=False, ao='prop'):
    """把目前累積的零件套用修改器、合併成一個物件。"""
    global _parts
    if not _parts:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in _parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = _parts[0]
    bpy.ops.object.convert(target='MESH')
    if len(_parts) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    TRIS[name] = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if ao and not glow and not name.endswith('__glow'):
        _ao(ob, ao)
    _parts = []
    return ob


# 常用色
WHITE = M('#ecebe4', 0.45)
GALV = M('#9ea4a8', 0.45, 0.6)
CONC = M('#b6b2a8', 0.9)
DARK = M('#2a2c2f', 0.6)
BLACK = M('#141416', 0.5)
STEEL = M('#d2d6da', 0.25, 0.9)
COPPER = M('#b8733f', 0.35, 0.8)
GLOW_W = M('#fff1cf', 0.3, 0, 6)
GLOW_Y = M('#ffc21a', 0.3, 0, 6)
GLOW_BULB = M('#ffd89a', 0.3, 0, 6)


# ================================================================ 物件
def ac_split():
    body = M('#e9e7df', 0.5)
    P('cube', body, (0, 0, 0.32), size=(0.8, 0.3, 0.55), bevel=0.025, bseg=1)
    # 風扇格柵：外框環、凹進去的深色盤、放射狀條、中心蓋
    fx, fz = -0.1, 0.32
    P('cyl', DARK, (fx, -0.148, fz), (PI / 2, 0, 0), (0.42, 0.42, 0.02), v=16)
    P('torus', body, (fx, -0.155, fz), (PI / 2, 0, 0), R=0.215, r=0.018, ms=16, mn=3)
    for k in range(1):
        P('torus', M('#cfcdc6', 0.5), (fx, -0.16, fz), (PI / 2, 0, 0), R=0.08 + k * 0.07, r=0.006, ms=16, mn=3)
    for k in range(4):
        a = k * PI / 3
        P('cube', M('#cfcdc6', 0.5), (fx, -0.162, fz), (0, k * PI / 4, 0), (0.4, 0.008, 0.012), smooth=False)
    P('cyl', M('#cfcdc6', 0.5), (fx, -0.165, fz), (PI / 2, 0, 0), (0.07, 0.07, 0.02), v=12)
    # 右側散熱鰭片（直條）
    for k in range(6):
        P('cube', M('#d6d4cc', 0.55), (0.3, -0.152, 0.14 + k * 0.06), size=(0.13, 0.01, 0.012), smooth=False)
    # 側面接管蓋＋銅管
    P('cube', M('#d9d7cf', 0.5), (0.405, 0.0, 0.25), size=(0.03, 0.18, 0.16), bevel=0.01)
    for k, dz in enumerate((0.22, 0.27)):
        tube([(0.42, -0.02 + k * 0.03, dz), (0.47, -0.02 + k * 0.03, dz), (0.5, 0.06 + k * 0.03, dz + 0.02), (0.5, 0.15, dz + 0.02)], 0.009 + k * 0.003, COPPER if k == 0 else M('#e8e6dc', 0.6), v=6)
    # L 型支架（固定在牆上）
    for sx in (-0.3, 0.3):
        P('cube', GALV, (sx, 0.0, 0.035), size=(0.04, 0.34, 0.03), bevel=0.004, bseg=1)
        P('cube', GALV, (sx, 0.155, 0.2), size=(0.04, 0.03, 0.34), bevel=0.004, bseg=1)
        P('cube', GALV, (sx, 0.08, 0.12), (-0.78, 0, 0), size=(0.03, 0.02, 0.24), smooth=False)
    commit('ac_split')


def ac_window():
    body = M('#e2dfd5', 0.5)
    P('cube', body, (0, 0, 0.225), size=(0.66, 0.6, 0.45), bevel=0.02)
    # 前面（朝路）出風口格柵
    P('cube', M('#cbc8bf', 0.55), (0, -0.303, 0.24), size=(0.6, 0.012, 0.38), bevel=0.006, bseg=1)
    for k in range(9):
        P('cube', M('#9c998f', 0.6), (0, -0.312, 0.08 + k * 0.038), size=(0.56, 0.012, 0.01), smooth=False)
    # 側邊進氣百葉
    for sx in (-1, 1):
        for k in range(6):
            P('cube', M('#bfbcb2', 0.6), (sx * 0.333, -0.05 + k * 0.05, 0.25), size=(0.008, 0.02, 0.3), smooth=False)
    # 底部滴水
    P('cyl', M('#cfcac0', 0.6), (0.25, -0.2, -0.01), (0, 0, 0), (0.03, 0.03, 0.04), v=8)
    commit('ac_window')


def water_tank_steel():
    frame = M('#55595c', 0.6, 0.4)
    # 鋼架：四腳＋上框
    for x in (-0.55, 0.55):
        for y in (-0.38, 0.38):
            P('cube', frame, (x, y, 0.3), size=(0.05, 0.05, 0.6), smooth=False)
    for y in (-0.38, 0.38):
        P('cube', frame, (0, y, 0.6), size=(1.2, 0.06, 0.05), smooth=False)
        P('cube', frame, (0, y, 0.12), size=(1.12, 0.04, 0.04), smooth=False)
    for x in (-0.55, 0.55):
        P('cube', frame, (x, 0, 0.6), size=(0.06, 0.82, 0.05), smooth=False)
        P('cube', frame, (x, 0, 0.32), (0.88, 0, 0), size=(0.03, 0.9, 0.03), smooth=False)
    # 臥式不鏽鋼桶＋兩端圓頂＋加強環
    P('cyl', STEEL, (0, 0, 0.96), (0, PI / 2, 0), (0.68, 0.68, 1.06), v=16, smooth='all', cap=False)
    for sx in (-1, 1):
        P('sph', STEEL, (sx * 0.53, 0, 0.96), (0, 0, PI / 2), (0.68, 0.22, 0.68), seg=16, ring=6, smooth='all')
        P('torus', STEEL, (sx * 0.35, 0, 0.96), (0, PI / 2, 0), R=0.345, r=0.012, ms=16, mn=3)
    P('cyl', STEEL, (0.2, 0, 1.33), (0, 0, 0), (0.18, 0.18, 0.06), v=14)
    tube([(-0.45, 0.25, 0.85), (-0.45, 0.25, 0.55), (-0.45, 0.4, 0.4), (-0.45, 0.4, 0.0)], 0.018, M('#9aa0a4', 0.4, 0.7), v=6)
    commit('water_tank_steel')


def water_tank_blue():
    blue = M('#2f6fb6', 0.45)
    frame = M('#55595c', 0.6, 0.4)
    for x in (-0.45, 0.45):
        for y in (-0.45, 0.45):
            P('cube', frame, (x, y, 0.2), size=(0.05, 0.05, 0.4), smooth=False)
    P('cube', frame, (0, 0, 0.4), size=(1.0, 1.0, 0.04), smooth=False)
    P('cyl', blue, (0, 0, 0.88), size=(0.95, 0.95, 0.9), v=16, smooth=40)
    for k in range(3):
        P('torus', blue, (0, 0, 0.58 + k * 0.28), R=0.48, r=0.02, ms=16, mn=3)
    P('sph', blue, (0, 0, 1.33), size=(0.95, 0.95, 0.22), seg=16, ring=5, smooth='all')
    P('cyl', M('#244f86', 0.5), (0, 0, 1.44), size=(0.32, 0.32, 0.08), v=14, bevel=0.01)
    tube([(0.3, 0.4, 0.55), (0.3, 0.55, 0.5), (0.3, 0.55, 0.0)], 0.02, M('#e8e6de', 0.6), v=6)
    commit('water_tank_blue')


def elec_pole(with_tr=True):
    pole = M('#b5b1a7', 0.85)
    P('cone', pole, (0, 0, 4.3), size=(0.38, 0.38, 8.6), top=0.62, v=14, smooth=40)
    P('cyl', pole, (0, 0, 8.62), size=(0.24, 0.24, 0.05), v=14)
    # 橫擔兩層（往路的方向 −Y 伸）
    arm = M('#7d7c74', 0.6, 0.3)
    for z, L in ((8.15, 2.0), (7.55, 1.5)):
        P('cube', arm, (0, -L / 2 + 0.35, z), size=(0.1, L, 0.1), bevel=0.01, bseg=1)
        P('cube', arm, (0, -0.25, z - 0.25), (0.75, 0, 0), size=(0.04, 0.04, 0.7), smooth=False)
        for k in range(3):
            y = 0.25 - k * (L - 0.2) / 2.4 - 0.2
            for j in range(2):
                P('cyl', WHITE, (0, y, z + 0.09 + j * 0.07), size=(0.11 - j * 0.02, 0.11 - j * 0.02, 0.05), v=8)
    # 號碼牌、腳踏釘
    P('cube', M('#f2d02c', 0.5), (0, -0.16, 2.6), size=(0.18, 0.01, 0.3), bevel=0.005, bseg=1)
    for k in range(4):
        P('cyl', GALV, (0.1 * (1 if k % 2 else -1), -0.12, 3.0 + k * 0.5), (PI / 2, 0, 0), (0.025, 0.025, 0.16), v=4)
    if with_tr:
        # 柱上變壓器：兩個灰桶掛在 +X 側
        tr = M('#8f979b', 0.55, 0.25)
        P('cube', arm, (0.6, 0, 6.05), size=(1.25, 0.1, 0.1), bevel=0.01, bseg=1)
        P('cube', arm, (0.6, 0, 5.15), size=(1.25, 0.08, 0.08), smooth=False)
        for k, x in enumerate((0.42, 0.98)):
            P('cyl', tr, (x, 0.0, 5.55), size=(0.44, 0.44, 0.8), v=14, smooth=40)
            P('cyl', tr, (x, 0.0, 5.98), size=(0.48, 0.48, 0.06), v=14)
            for j in range(3):
                a = j * 2 * PI / 3 + 0.5
                P('cube', tr, (x + math.cos(a) * 0.22, math.sin(a) * 0.22, 5.5), (0, 0, a), size=(0.05, 0.02, 0.55), smooth=False)
            P('cyl', WHITE, (x, 0, 6.1), size=(0.07, 0.07, 0.14), v=6)
        tube([(0.42, 0, 6.17), (0.35, -0.3, 6.9), (0.1, -0.55, 7.6)], 0.012, BLACK, v=4)
        tube([(0.98, 0, 6.17), (0.7, -0.35, 7.0), (0.1, -1.0, 7.62)], 0.012, BLACK, v=4)
    commit('elec_pole' if with_tr else 'elec_pole_plain')


def street_lamp():
    pole = M('#8d9397', 0.45, 0.55)
    P('cyl', CONC, (0, 0, 0.15), size=(0.5, 0.5, 0.3), v=12, bevel=0.03)
    P('cone', pole, (0, 0, 4.0), size=(0.26, 0.26, 7.7), top=0.6, v=12, smooth=40)
    # 彎臂：從桿頂往 −Y 彎出去 2 m
    pts = [(0, 0, 7.6)] + arc((0, -0.6, 7.6), 0.6, PI, PI / 2, 6, 'YZ')[1:] + [(0, -1.8, 8.22), (0, -2.05, 8.18)]
    # arc 用 YZ：(y=c.y+R cos a, z=c.z+R sin a)；a 從 π→π/2：y −0.6−0.6→−0.6，z 7.6→8.2
    pts = [(0, 0, 7.6)] + [(0, -0.6 + 0.6 * math.cos(a), 7.6 + 0.6 * math.sin(a)) for a in [PI * (1 - i / 12) for i in range(1, 7)]] + [(0, -1.8, 8.2), (0, -2.0, 8.17)]
    pts = [(0, 0, 7.6), (0, -0.02, 7.9), (0, -0.12, 8.1), (0, -0.3, 8.2), (0, -0.6, 8.24), (0, -1.9, 8.2)]
    tube(pts, 0.05, pole, v=8)
    # 燈罩
    P('sph', M('#6e7478', 0.4, 0.5), (0, -2.15, 8.12), size=(0.42, 0.85, 0.22), seg=16, ring=8, smooth='all')
    commit('street_lamp')
    P('cyl', GLOW_W, (0, -2.15, 8.03), size=(0.32, 0.66, 0.03), v=16)
    commit('street_lamp__glow')


def traffic_pole():
    g = M('#9aa0a4', 0.4, 0.6)
    P('cube', CONC, (0, 0, 0.1), size=(0.7, 0.7, 0.2), bevel=0.03)
    P('cyl', g, (0, 0, 0.24), size=(0.48, 0.48, 0.1), v=16, bevel=0.01)
    P('cone', g, (0, 0, 3.25), size=(0.36, 0.36, 6.5), top=0.75, v=16, smooth=40)
    P('cyl', g, (0, 0, 6.52), size=(0.3, 0.3, 0.06), v=16)
    # 橫臂往 −Y 7 m（漸細）＋斜撐
    P('cone', g, (0, -3.5, 6.0), (PI / 2, 0, 0), (0.22, 0.22, 7.0), top=0.55, v=12, smooth=40)
    tube([(0, 0, 5.3), (0, -1.0, 5.75), (0, -2.2, 6.0)], 0.04, g, v=6)
    P('cyl', g, (0, -7.0, 6.0), (PI / 2, 0, 0), (0.13, 0.13, 0.04), v=10)
    # 路名牌
    P('cube', M('#1f5fb4', 0.4), (0, -1.6, 5.55), size=(0.02, 1.4, 0.35), bevel=0.01, bseg=1)
    P('cube', WHITE, (0, -1.6, 5.55), size=(0.025, 1.32, 0.27), smooth=False)
    commit('traffic_pole')


def _canopy(blobs, colors, disp=(0.22, 0.28), seg=12, ring=8):
    for (x, y, z, r, sx, sy, sz), c in zip(blobs, colors):
        P('sph', c, (x, y, z), (random.random() * 3, random.random() * 3, random.random() * 3), (r * 2 * sx, r * 2 * sy, r * 2 * sz), seg=seg, ring=ring, smooth='all', disp=(disp[0] * r, disp[1]))


def tree_banyan():
    bark = M('#5b4b3d', 0.9)
    P('cone', bark, (0, 0, 1.6), size=(0.6, 0.6, 3.2), top=0.65, v=10, smooth=40)
    # 根部隆起
    for k in range(4):
        a = k * PI / 2 + 0.4
        P('cone', bark, (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.18), (math.sin(a) * 0.9, -math.cos(a) * 0.9, 0), (0.22, 0.22, 0.7), top=0.2, v=6)
    # 主枝
    for k in range(3):
        a = k * 2.1 + 0.3
        P('cone', bark, (math.cos(a) * 0.6, math.sin(a) * 0.6, 3.4), (math.sin(a) * 0.7, -math.cos(a) * 0.7, 0), (0.24, 0.24, 1.8), top=0.4, v=6)
    # 氣根
    for k in range(7):
        a = random.random() * 2 * PI
        r = 0.9 + random.random() * 1.0
        h = 1.2 + random.random() * 1.2
        P('cyl', M('#6b5a48', 0.9), (math.cos(a) * r, math.sin(a) * r, 4.2 - h / 2), size=(0.03, 0.03, h), v=4)
    greens = [M('#2f5f2a', 0.8), M('#3c6e30', 0.8), M('#4a7d36', 0.8), M('#2a5426', 0.8)]
    blobs = []
    for k in range(7):
        a = k / 7 * 2 * PI + random.random() * 0.4
        r = 1.7 + random.random() * 0.5
        blobs.append((math.cos(a) * r, math.sin(a) * r, 4.3 + random.random() * 0.7, 1.05 + random.random() * 0.3, 1.0, 1.0, 0.72))
    blobs.append((0.3, -0.2, 5.4, 1.5, 1.0, 1.0, 0.75))
    blobs.append((-0.5, 0.4, 5.1, 1.3, 1.0, 1.0, 0.75))
    _canopy(blobs, [greens[i % 4] for i in range(len(blobs))], seg=11, ring=7)
    commit('tree_banyan', ao='tree')


def tree_luan():
    bark = M('#6a5a4c', 0.9)
    P('cone', bark, (0, 0, 1.7), size=(0.34, 0.34, 3.4), top=0.6, v=10, smooth=40)
    for k in range(3):
        a = k * 2.1 + 1.0
        P('cone', bark, (math.cos(a) * 0.4, math.sin(a) * 0.4, 3.5), (math.sin(a) * 0.6, -math.cos(a) * 0.6, 0), (0.16, 0.16, 1.4), top=0.4, v=6)
    greens = [M('#7a9a3a', 0.8), M('#8fae45', 0.8), M('#a3b84c', 0.8), M('#6f8f35', 0.8)]
    blobs = []
    for k in range(5):
        a = k / 5 * 2 * PI
        blobs.append((math.cos(a) * 1.1, math.sin(a) * 1.1, 4.2 + random.random() * 0.5, 1.0 + random.random() * 0.25, 1, 1, 0.85))
    blobs.append((0, 0, 4.9, 1.3, 1, 1, 0.9))
    _canopy(blobs, [greens[i % 4] for i in range(len(blobs))], seg=10, ring=7)
    # 紅褐色蒴果叢
    caps = [M('#b4563a', 0.8), M('#c9703f', 0.8), M('#a84a36', 0.8)]
    for k in range(16):
        a = random.random() * 2 * PI
        r = 1.3 + random.random() * 0.7
        P('ico', caps[k % 3], (math.cos(a) * r, math.sin(a) * r, 4.4 + random.random() * 1.3), size=(0.3, 0.3, 0.24), sd=1, smooth='all')
    commit('tree_luan', ao='tree')


def _frond(base, ang, tilt, L, w, mat, droop=0.35, n=6):
    """一片羽狀葉：沿長度的窄條，中段拱起再下垂；兩側小葉以鋸齒邊表現。"""
    ca, sa = math.cos(ang), math.sin(ang)
    verts, faces = [], []
    for i in range(n + 1):
        t = i / n
        d = L * t
        # 拱起然後下垂
        z = base[2] + math.sin(tilt) * d - droop * L * t * t
        hw = w * math.sin(PI * min(1, t * 1.15)) * (1.0 if i % 2 == 0 else 0.7) + 0.02
        cx, cy = base[0] + ca * d * math.cos(tilt), base[1] + sa * d * math.cos(tilt)
        # 橫向（垂直於葉軸），稍微 V 形
        px, py = -sa, ca
        verts += [(cx + px * hw, cy + py * hw, z - hw * 0.25), (cx, cy, z + 0.03), (cx - px * hw, cy - py * hw, z - hw * 0.25)]
        if i:
            b0, b1 = (i - 1) * 3, i * 3
            faces += [(b0, b1, b1 + 1, b0 + 1), (b0 + 1, b1 + 1, b1 + 2, b0 + 2)]
    ob = mesh_part('frond', verts, faces, mat, smooth='all')
    s = ob.modifiers.new('Solid', 'SOLIDIFY')
    s.thickness = 0.02
    return ob


def betel_palm():
    trunk = M('#9a958a', 0.85)
    H = 9.0
    P('cone', trunk, (0, 0, H / 2), size=(0.24, 0.24, H), top=0.75, v=10, smooth=40)
    for k in range(9):
        P('torus', M('#857f73', 0.9), (0, 0, 0.6 + k * 0.85), R=0.105 - k * 0.003, r=0.012, ms=8, mn=3)
    P('cyl', M('#6d8a3a', 0.6), (0, 0, H + 0.45), size=(0.2, 0.2, 0.9), v=10, smooth=40)  # 綠色冠莖
    green = [M('#3f7a2c', 0.75), M('#4d8a34', 0.75)]
    for k in range(8):
        a = k / 8 * 2 * PI + random.random() * 0.2
        _frond((0, 0, H + 0.85), a, 0.5 + random.random() * 0.3, 2.9, 0.42, green[k % 2], droop=0.6)
    # 檳榔串
    for k in range(5):
        P('sph', M('#5f8a2a', 0.6), (0.14 + random.random() * 0.06, random.random() * 0.1 - 0.05, H - 0.1 - k * 0.07), size=(0.07, 0.07, 0.09), seg=6, ring=4)
    commit('betel_palm', ao='tree')


def coconut_palm():
    trunk = M('#8e7f6a', 0.9)
    pts = [(0, 0, 0), (0.15, 0, 2.0), (0.45, 0, 4.0), (0.9, 0, 5.8), (1.4, 0, 7.2)]
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        d = b - a
        mid = (a + b) / 2
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
        P('cone', trunk, mid, rot, (0.42 - i * 0.05, 0.42 - i * 0.05, d.length * 1.02), top=0.88, v=10, smooth=40)
    top = pts[-1]
    green = [M('#3d7a2a', 0.75), M('#4c8a30', 0.75), M('#5b9436', 0.75)]
    for k in range(9):
        a = k / 9 * 2 * PI + random.random() * 0.3
        _frond(top, a, 0.25 + random.random() * 0.3, 3.2, 0.5, green[k % 3], droop=0.7, n=7)
    for k in range(4):
        a = k * PI / 2
        P('sph', M('#6b8f2c', 0.6), (top[0] + math.cos(a) * 0.22, top[1] + math.sin(a) * 0.22, top[2] - 0.3), size=(0.26, 0.26, 0.3), seg=10, ring=6, smooth='all')
    commit('coconut_palm', ao='tree')


def potted_plant():
    pot = M('#b5552e', 0.85)
    P('cone', pot, (0, 0, 0.19), size=(0.4, 0.4, 0.38), top=1.3, v=16, smooth=40)
    P('torus', pot, (0, 0, 0.38), R=0.255, r=0.03, ms=16, mn=5)
    P('cyl', M('#3d2c20', 1.0), (0, 0, 0.37), size=(0.48, 0.48, 0.02), v=16)
    greens = [M('#2f6a2c', 0.8), M('#3f7d33', 0.8), M('#4f8c3a', 0.8)]
    _canopy([(0.0, 0.0, 0.75, 0.32, 1, 1, 1.2), (0.12, 0.06, 0.62, 0.22, 1, 1, 1), (-0.12, -0.04, 0.6, 0.22, 1, 1, 1)], greens, disp=(0.25, 0.15), seg=10, ring=7)
    commit('potted_plant')


def mailbox_pair():
    for x, col in ((-0.32, '#2e8a3e'), (0.32, '#c62a24')):
        m = M(col, 0.45)
        P('cube', M('#4a4a4a', 0.6), (x, 0, 0.06), size=(0.42, 0.4, 0.12), bevel=0.02)
        P('cube', m, (x, 0, 0.62), size=(0.46, 0.44, 1.0), bevel=0.035, bseg=3)
        P('cyl', m, (x, 0, 1.12), (0, PI / 2, 0), (0.44, 0.46, 0.46), v=20, smooth=40)  # 圓頂
        P('cube', BLACK, (x, -0.222, 0.98), size=(0.28, 0.02, 0.045), bevel=0.008, bseg=1)  # 投信口
        P('cube', WHITE, (x, -0.222, 0.72), size=(0.3, 0.012, 0.16), bevel=0.01, bseg=1)  # 標示牌
        P('cube', M('#d8b84a', 0.4, 0.5), (x, -0.224, 0.48), size=(0.1, 0.01, 0.06), smooth=False)
    commit('mailbox_pair')


def transformer_box():
    g = M('#3d7a4f', 0.5)
    P('cube', CONC, (0, 0, 0.075), size=(1.35, 0.85, 0.15), bevel=0.02)
    P('cube', g, (0, 0, 0.85), size=(1.2, 0.7, 1.4), bevel=0.03, bseg=2)
    P('cube', g, (0, 0, 1.57), size=(1.28, 0.78, 0.05), bevel=0.015, bseg=1)
    # 門縫、把手、百葉
    P('cube', M('#25523a', 0.6), (0, -0.352, 0.85), size=(0.012, 0.01, 1.2), smooth=False)
    for sx in (-0.07, 0.07):
        P('cube', GALV, (sx, -0.36, 0.9), size=(0.03, 0.03, 0.14), bevel=0.008, bseg=1)
    for sx in (-0.35, 0.35):
        for k in range(5):
            P('cube', M('#2f6440', 0.6), (sx, -0.354, 1.25 + k * 0.045), size=(0.32, 0.012, 0.012), smooth=False)
    P('cube', M('#f2d02c', 0.5), (0.35, -0.353, 0.75), size=(0.2, 0.01, 0.2), smooth=False)
    P('cube', BLACK, (0.35, -0.356, 0.75), size=(0.07, 0.01, 0.1), smooth=False)
    commit('transformer_box')


def stall_cart():
    # 攤車 3×1.2：不鏽鋼台＋玻璃櫥＋遮雨棚架；朝路是 −Y
    P('cube', STEEL, (0, 0, 0.5), size=(3.0, 1.2, 0.8), bevel=0.025)
    P('cube', M('#c9cdd1', 0.3, 0.8), (0, 0, 0.91), size=(3.04, 1.24, 0.04), bevel=0.01, bseg=1)
    for x in (-1.3, 1.3):
        for y in (-0.45, 0.45):
            P('cyl', BLACK, (x, y, 0.08), (0, PI / 2, 0), (0.16, 0.16, 0.06), v=12, bevel=0.01, bseg=1)
    glass = M('#a9c4d2', 0.05, 0.1)
    P('cube', glass, (-0.6, -0.15, 1.15), size=(1.5, 0.8, 0.44), bevel=0.01, bseg=1)
    P('cube', STEEL, (-0.6, -0.15, 1.38), size=(1.54, 0.84, 0.03), smooth=False)
    # 櫥窗裡的食物
    for k in range(6):
        P('ico', M(random.choice(['#c8742a', '#e8d0a0', '#a83a20', '#d9a050', '#7aa040']), 0.7), (-1.2 + k * 0.24, -0.2, 1.0), size=(0.18, 0.2, 0.1), sd=1, smooth='all')
    # 瓦斯爐、鍋
    P('cyl', BLACK, (0.85, 0, 0.98), size=(0.45, 0.45, 0.1), v=16, bevel=0.01)
    P('sph', M('#3a3a3a', 0.4, 0.6), (0.85, 0, 1.08), size=(0.55, 0.55, 0.22), seg=16, ring=6, smooth='all')
    # 棚架：四支桿＋橫桿
    pole = M('#7a7a7a', 0.4, 0.6)
    for x in (-1.45, 1.45):
        for y in (-0.55, 0.55):
            P('cyl', pole, (x, y, 1.45), size=(0.04, 0.04, 1.9 if y > 0 else 1.65), v=6)
    P('cyl', pole, (0, -0.55, 2.27), (0, PI / 2, 0), (0.035, 0.035, 2.9), v=6)
    P('cyl', pole, (0, 0.55, 2.4), (0, PI / 2, 0), (0.035, 0.035, 2.9), v=6)
    # 遮雨棚（往路面斜）
    P('cube', M('#c8342a', 0.7), (0, 0, 2.36), (-0.12, 0, 0), (3.1, 1.45, 0.025), bevel=0.01, bseg=1)
    P('cube', M('#f2efe6', 0.7), (0, -0.74, 2.25), (0, 0, 0), (3.1, 0.02, 0.16), smooth=False)
    # 招牌板
    P('cube', M('#d23a2a', 0.5), (0, -0.56, 2.08), size=(2.6, 0.03, 0.32), bevel=0.01, bseg=1)
    commit('stall_cart')
    for k in range(4):
        P('sph', GLOW_BULB, (-1.05 + k * 0.7, -0.4, 2.15), size=(0.09, 0.09, 0.11), seg=8, ring=6, smooth='all')
    commit('stall_cart__glow')


def bus_shelter():
    frame = M('#5a6066', 0.45, 0.5)
    for x in (-1.75, 1.75):
        P('cube', frame, (x, 0.45, 1.3), size=(0.09, 0.09, 2.6), bevel=0.01, bseg=1)
        P('cube', frame, (x, -0.25, 1.3), size=(0.07, 0.07, 2.6), bevel=0.01, bseg=1)
    # 弧形屋頂
    verts, faces = [], []
    n = 8
    for i in range(n + 1):
        t = i / n
        y = -0.85 + 1.75 * t
        z = 2.62 + 0.18 * math.sin(PI * t)
        verts += [(-1.95, y, z), (1.95, y, z)]
        if i:
            b0, b1 = (i - 1) * 2, i * 2
            faces.append((b0, b0 + 1, b1 + 1, b1))
    ob = mesh_part('roof', verts, faces, M('#d9dde0', 0.35, 0.3), smooth='all')
    s = ob.modifiers.new('Solid', 'SOLIDIFY'); s.thickness = 0.05
    glass = M('#a7c0cc', 0.05, 0.1)
    P('cube', glass, (0, 0.47, 1.35), size=(3.4, 0.02, 1.8), smooth=False)
    P('cube', frame, (0, 0.47, 0.42), size=(3.5, 0.05, 0.06), smooth=False)
    P('cube', frame, (0, 0.47, 2.28), size=(3.5, 0.05, 0.06), smooth=False)
    # 側邊廣告燈箱
    P('cube', frame, (1.82, 0.1, 1.35), size=(0.12, 0.75, 1.85), bevel=0.02)
    P('cube', M('#f2f2f0', 0.4), (1.885, 0.1, 1.35), size=(0.01, 0.65, 1.7), smooth=False)
    # 座椅
    P('cube', STEEL, (0, 0.25, 0.48), size=(2.4, 0.38, 0.05), bevel=0.01, bseg=1)
    for x in (-1.0, 1.0):
        P('cube', frame, (x, 0.3, 0.24), size=(0.05, 0.25, 0.48), smooth=False)
    # 站牌桿
    P('cyl', GALV, (-2.4, -0.6, 1.5), size=(0.08, 0.08, 3.0), v=8)
    P('cube', M('#2f6fb6', 0.4), (-2.4, -0.6, 2.75), size=(0.5, 0.05, 0.6), bevel=0.02)
    P('cube', WHITE, (-2.4, -0.628, 2.75), size=(0.42, 0.01, 0.5), smooth=False)
    commit('bus_shelter')


def mirror_pole():
    orange = M('#e2641b', 0.45)
    P('cyl', orange, (0, 0, 1.6), size=(0.08, 0.08, 3.2), v=10)
    P('cube', orange, (0, -0.06, 3.15), size=(0.06, 0.14, 0.12), smooth=False)
    rot = (-0.25, 0, 0)
    P('torus', orange, (0, -0.14, 3.3), (PI / 2 - 0.25, 0, 0), R=0.4, r=0.04, ms=24, mn=6)
    P('sph', M('#cfd8de', 0.03, 1.0), (0, -0.13, 3.3), (PI / 2 - 0.25, 0, 0), (0.8, 0.8, 0.14), seg=24, ring=6, smooth='all')
    P('cyl', M('#3a3a3a', 0.6), (0, -0.08, 3.3), (PI / 2 - 0.25, 0, 0), (0.82, 0.82, 0.05), v=24)
    commit('mirror_pole')


def parking_meter():
    P('cyl', GALV, (0, 0, 0.55), size=(0.08, 0.08, 1.1), v=8)
    P('cube', M('#2b4f8a', 0.4), (0, 0, 1.3), size=(0.28, 0.2, 0.42), bevel=0.04, bseg=3)
    P('cube', M('#9fd0ff', 0.1), (0, -0.101, 1.38), size=(0.17, 0.01, 0.1), smooth=False)
    P('cube', BLACK, (0, -0.101, 1.22), size=(0.05, 0.01, 0.05), smooth=False)
    commit('parking_meter')


def fire_hydrant():
    red = M('#c8261f', 0.45)
    P('cyl', red, (0, 0, 0.05), size=(0.34, 0.34, 0.1), v=16, bevel=0.015)
    P('cyl', red, (0, 0, 0.4), size=(0.26, 0.26, 0.62), v=16, smooth=40)
    P('torus', red, (0, 0, 0.7), R=0.14, r=0.025, ms=16, mn=5)
    P('sph', red, (0, 0, 0.74), size=(0.27, 0.27, 0.2), seg=16, ring=6, smooth='all')
    P('cyl', red, (0, 0, 0.86), size=(0.08, 0.08, 0.06), v=6)
    for sx in (-1, 1):
        P('cyl', red, (sx * 0.17, 0, 0.5), (0, PI / 2, 0), (0.12, 0.12, 0.12), v=12)
        P('cyl', M('#e8c84a', 0.4, 0.6), (sx * 0.24, 0, 0.5), (0, PI / 2, 0), (0.1, 0.1, 0.04), v=6)
    commit('fire_hydrant')


def cone():
    orange = M('#ff5a1a', 0.5)
    P('cube', BLACK, (0, 0, 0.02), size=(0.42, 0.42, 0.04), bevel=0.02)
    P('cone', orange, (0, 0, 0.38), size=(0.34, 0.34, 0.68), top=0.15, v=16, smooth=40)
    P('cone', M('#f4f4f0', 0.35), (0, 0, 0.46), size=(0.255, 0.255, 0.14), top=0.79, v=16, smooth=40)
    P('cone', M('#f4f4f0', 0.35), (0, 0, 0.29), size=(0.3, 0.3, 0.08), top=0.92, v=16, smooth=40)
    commit('cone')


def barrier():
    # 施工圍籬：寬 2 m（沿 X）、高 1.1 m；紅白相間板
    frame = M('#2a2c2f', 0.5)
    for x in (-0.95, 0.95):
        P('cube', frame, (x, 0, 0.55), size=(0.06, 0.06, 1.1), bevel=0.008, bseg=1)
        P('cube', frame, (x, 0, 0.03), size=(0.1, 0.6, 0.06), bevel=0.01, bseg=1)
    for row, z in enumerate((0.45, 0.8)):
        for k in range(4):
            col = '#d02a22' if (k + row) % 2 else '#f1f1ec'
            P('cube', M(col, 0.45), (-0.71 + k * 0.47, 0, z), size=(0.47, 0.04, 0.24), bevel=0.012, bseg=1)
    P('cube', frame, (0.9, 0, 1.13), size=(0.08, 0.08, 0.06), smooth=False)
    commit('barrier')
    P('sph', GLOW_Y, (0.9, 0, 1.22), size=(0.15, 0.15, 0.13), seg=12, ring=8, smooth='all')
    commit('barrier__glow')


def temple_lion():
    stone = M('#a8a49a', 0.85)
    dark = M('#8e8a80', 0.9)
    P('cube', dark, (0, 0, 0.35), size=(0.85, 0.85, 0.7), bevel=0.04)
    P('cube', stone, (0, 0, 0.73), size=(0.95, 0.95, 0.06), bevel=0.02)
    # 坐姿身體
    P('sph', stone, (0, 0.12, 1.15), (0.25, 0, 0), (0.55, 0.62, 0.78), seg=12, ring=8, smooth='all')
    # 前腳
    for sx in (-0.15, 0.15):
        P('cyl', stone, (sx, -0.18, 1.0), (0.1, 0, 0), (0.15, 0.15, 0.55), v=10, smooth=40)
        P('sph', stone, (sx, -0.24, 0.78), (0, 0, 0), (0.2, 0.24, 0.1), seg=10, ring=6, smooth='all')
    # 頭、鬃毛、眼、嘴
    P('sph', stone, (0, -0.12, 1.62), (0, 0, 0), (0.5, 0.46, 0.46), seg=12, ring=8, smooth='all')
    for k in range(10):
        a = k / 10 * 2 * PI
        P('sph', dark, (math.cos(a) * 0.24, 0.03, 1.62 + math.sin(a) * 0.24), (0, 0, 0), (0.17, 0.17, 0.17), seg=6, ring=4, smooth='all')
    P('sph', stone, (0, -0.33, 1.56), (0, 0, 0), (0.26, 0.2, 0.18), seg=12, ring=6, smooth='all')
    for sx in (-0.1, 0.1):
        P('sph', M('#3a3630', 0.7), (sx, -0.32, 1.7), (0, 0, 0), (0.07, 0.05, 0.06), seg=8, ring=6, smooth='all')
    P('sph', M('#3a3630', 0.7), (0, -0.4, 1.5), (0, 0, 0), (0.14, 0.06, 0.05), seg=8, ring=4, smooth='all')
    # 腳下的繡球
    P('sph', stone, (0.3, -0.28, 0.88), (0, 0, 0), (0.22, 0.22, 0.22), seg=12, ring=8, smooth='all')
    commit('temple_lion')


def incense_burner():
    bronze = M('#6b5a2a', 0.45, 0.7)
    P('cube', M('#8e8a80', 0.9), (0, 0, 0.3), size=(1.0, 1.0, 0.6), bevel=0.04)
    for k in range(3):
        a = k * 2 * PI / 3 + PI / 2
        P('cone', bronze, (math.cos(a) * 0.28, math.sin(a) * 0.28, 0.75), size=(0.12, 0.12, 0.3), top=0.6, v=8)
    P('sph', bronze, (0, 0, 1.08), size=(0.85, 0.85, 0.55), seg=20, ring=10, smooth='all')
    P('torus', bronze, (0, 0, 1.3), R=0.38, r=0.035, ms=20, mn=5)
    for sx in (-1, 1):
        P('torus', bronze, (sx * 0.46, 0, 1.3), (PI / 2, 0, 0), R=0.08, r=0.022, ms=12, mn=4)
    # 蓋子：兩層屋頂
    P('cone', bronze, (0, 0, 1.48), size=(0.7, 0.7, 0.18), top=0.45, v=8)
    P('cyl', bronze, (0, 0, 1.6), size=(0.3, 0.3, 0.1), v=8)
    P('cone', bronze, (0, 0, 1.72), size=(0.42, 0.42, 0.14), top=0.3, v=8)
    P('sph', M('#c9a03a', 0.35, 0.8), (0, 0, 1.85), size=(0.12, 0.12, 0.14), seg=10, ring=6, smooth='all')
    commit('incense_burner')


def scooter_parked(idx, col):
    body = M(col, 0.35)
    seat = M('#1b1b1d', 0.55)
    dark = M('#2c2e31', 0.6)
    # 朝路＝−Y 為車頭；長 1.85、寬 0.66
    tire = BLACK
    for y in (-0.62, 0.6):
        P('cyl', tire, (0, y, 0.24), (0, PI / 2, 0), (0.46, 0.46, 0.11), v=10, smooth=40)
        P('cyl', M('#9da3a8', 0.35, 0.7), (0, y, 0.24), (0, PI / 2, 0), (0.26, 0.26, 0.12), v=6)
    # 踏板
    P('cube', dark, (0, -0.05, 0.36), size=(0.4, 0.62, 0.06), smooth=False)
    # 後車身（圓弧）
    P('cube', body, (0, 0.42, 0.58), (0.12, 0, 0), (0.46, 0.72, 0.42), bevel=0.12, bseg=2)
    # 坐墊
    P('cube', seat, (0, 0.38, 0.84), (0.06, 0, 0), (0.36, 0.68, 0.12), bevel=0.05, bseg=2)
    # 前擋板（傾斜）
    P('cube', body, (0, -0.48, 0.62), (-0.32, 0, 0), (0.48, 0.12, 0.62), bevel=0.06, bseg=2)
    # 前土除
    P('cube', body, (0, -0.64, 0.42), (-0.6, 0, 0), (0.18, 0.3, 0.06), smooth=False)
    # 龍頭、把手、大燈
    P('cube', body, (0, -0.56, 1.0), (-0.3, 0, 0), (0.42, 0.16, 0.16), bevel=0.05, bseg=1)
    P('cyl', dark, (0, -0.57, 1.04), (0, PI / 2, 0), (0.035, 0.035, 0.68), v=6)
    P('cube', M('#f4f2e6', 0.2), (0, -0.66, 0.98), (-0.3, 0, 0), (0.22, 0.04, 0.08), smooth=False)
    # 後照鏡
    for sx in (-0.22, 0.22):
        P('cube', dark, (sx, -0.55, 1.13), (0.2, 0, 0), (0.015, 0.015, 0.18), smooth=False)
        P('cube', dark, (sx * 1.05, -0.53, 1.23), size=(0.1, 0.02, 0.07), smooth=False)
    # 尾燈、後扶手
    P('cube', M('#b3121b', 0.3), (0, 0.79, 0.68), size=(0.3, 0.04, 0.07), smooth=False)
    P('cube', GALV, (0, 0.72, 0.84), size=(0.32, 0.12, 0.03), smooth=False)
    # 排氣管
    P('cyl', M('#5a5d60', 0.4, 0.7), (-0.2, 0.55, 0.3), (PI / 2 - 0.1, 0, 0), (0.08, 0.08, 0.42), v=6)
    commit(f'scooter_parked_{idx}')


# ---------------------------------------------------------------- 產生
ac_split()
ac_window()
water_tank_steel()
water_tank_blue()
elec_pole(True)
elec_pole(False)
street_lamp()
traffic_pole()
tree_banyan()
tree_luan()
betel_palm()
coconut_palm()
potted_plant()
mailbox_pair()
transformer_box()
stall_cart()
bus_shelter()
mirror_pole()
parking_meter()
fire_hydrant()
cone()
barrier()
temple_lion()
incense_burner()
for i, c in enumerate(['#ecebe6', '#c23a2e', '#2b4a9a', '#232325']):
    scooter_parked(i, c)

for name, n in TRIS.items():
    print(f'[props] {name}: {n} tris')

bpy.ops.object.select_all(action='SELECT')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
    export_texcoords=False, export_normals=True, export_materials='EXPORT',
    export_cameras=False, export_lights=False, export_animations=False,
    export_vertex_color='ACTIVE',
)
print('[props] wrote', OUT, os.path.getsize(OUT), 'bytes')

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  console.log('===', f);
  console.log('extensions:', root.listExtensionsUsed().map((e) => e.extensionName));
  console.log('scenes', root.listScenes().length, 'nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'materials', root.listMaterials().length, 'textures', root.listTextures().length);
  for (const n of root.listNodes()) console.log(' node', JSON.stringify(n.getName()), 'T', n.getTranslation().map((v) => +v.toFixed(3)), 'R', n.getRotation().map((v) => +v.toFixed(3)), 'S', n.getScale().map((v) => +v.toFixed(3)), 'mesh', n.getMesh()?.getName());
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), idx = p.getIndices();
      const mn = pos.getMin([]), mx = pos.getMax([]);
      console.log(' mesh', JSON.stringify(m.getName()), 'verts', pos.getCount(), 'tris', idx ? idx.getCount() / 3 : pos.getCount() / 3, 'attrs', p.listSemantics().join(','), 'min', mn.map((v) => +v.toFixed(3)), 'max', mx.map((v) => +v.toFixed(3)), 'mat', p.getMaterial()?.getName());
    }
  }
  for (const t of root.listTextures()) console.log(' texture', JSON.stringify(t.getName()), t.getMimeType(), t.getSize(), (t.getImage()?.byteLength / 1024).toFixed(0) + ' KB');
  for (const mt of root.listMaterials()) console.log(' material', JSON.stringify(mt.getName()), 'base', !!mt.getBaseColorTexture(), 'normal', !!mt.getNormalTexture(), 'mr', !!mt.getMetallicRoughnessTexture(), 'alphaMode', mt.getAlphaMode(), 'doubleSided', mt.getDoubleSided());
}

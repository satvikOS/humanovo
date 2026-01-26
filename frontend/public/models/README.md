# GenUp 3D Anatomy Models

This directory contains 3D anatomical models for the Human Anatomy Viewer.

## Supported Model Formats

- **GLB/GLTF** (Recommended) - Binary GL Transmission Format
- **OBJ** - Wavefront OBJ format
- **STL** - Stereolithography format
- **FBX** - Autodesk FBX format

## Directory Structure

```
models/
├── bp3d/                    # BodyParts3D models
│   ├── skeletal/           # Skeletal system models
│   ├── muscular/           # Muscular system models
│   ├── nervous/            # Nervous system models
│   ├── circulatory/        # Circulatory system models
│   ├── respiratory/        # Respiratory system models
│   ├── digestive/          # Digestive system models
│   ├── urinary/            # Urinary system models
│   ├── lymphatic/          # Lymphatic system models
│   ├── reproductive/       # Reproductive system models
│   ├── endocrine/          # Endocrine system models
│   └── integumentary/      # Skin/integumentary models
├── custom/                  # Custom/proprietary models
└── samples/                 # Sample models for testing
```

## BodyParts3D Models

### Source
[BodyParts3D/Anatomography](https://lifesciencedb.jp/bp3d/?lng=en)

### License
**Creative Commons Attribution-ShareAlike 2.1 Japan (CC BY-SA 2.1)**

**Attribution Required:**
```
BodyParts3D, Copyright© 2008 Life Science Integrated Database Center
licensed by CC Attribution-Share Alike 2.1 Japan
```

### Downloading BP3D Models

1. Visit the [BodyParts3D GitHub mirror](https://github.com/Kevin-Mattheus-Moerman/BodyParts3D)
2. Download the OBJ files from the `BodyParts3D-4.0` directory
3. Convert to GLB format using Blender for better performance:

```bash
# In Blender Python console or as a script:
import bpy
bpy.ops.import_scene.obj(filepath="model.obj")
bpy.ops.export_scene.gltf(filepath="model.glb", export_format='GLB')
```

### File Naming Convention

```
{fma_id}_{structure_name}.glb
```

Example: `FMA_46565_skull.glb`

## Converting Custom Models

### From .STZ Files (Blender Studio)

The .stz format may be a compressed archive or proprietary format. To use:

1. **If it's a ZIP archive:** Rename to `.zip` and extract
2. **If it's a Blender file:** Open in Blender and export as GLB

```bash
# Try extracting as archive
mv sample.stz sample.zip
unzip sample.zip
```

Or in Blender:
```python
import bpy

# Import if it's a recognized format
# Then export as GLB
bpy.ops.export_scene.gltf(
    filepath="/path/to/output.glb",
    export_format='GLB',
    use_selection=False
)
```

### From OBJ Files

```python
import bpy
bpy.ops.import_scene.obj(filepath="input.obj")
bpy.ops.export_scene.gltf(filepath="output.glb", export_format='GLB')
```

### From STL Files

```python
import bpy
bpy.ops.import_mesh.stl(filepath="input.stl")
bpy.ops.export_scene.gltf(filepath="output.glb", export_format='GLB')
```

### From FBX Files

```python
import bpy
bpy.ops.import_scene.fbx(filepath="input.fbx")
bpy.ops.export_scene.gltf(filepath="output.glb", export_format='GLB')
```

## Model Optimization

For best performance:

1. **Reduce polygon count** - Target <50K triangles per model
2. **Use Draco compression** - Enable when exporting GLB
3. **Remove unnecessary data** - Animations, cameras, lights if not needed
4. **Center and scale** - Ensure models are centered at origin

### Blender Optimization Script

```python
import bpy

# Select all mesh objects
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

        # Apply modifiers
        for mod in obj.modifiers:
            bpy.ops.object.modifier_apply(modifier=mod.name)

        # Decimate if needed
        if len(obj.data.polygons) > 50000:
            bpy.ops.object.modifier_add(type='DECIMATE')
            obj.modifiers["Decimate"].ratio = 50000 / len(obj.data.polygons)
            bpy.ops.object.modifier_apply(modifier="Decimate")

# Export with Draco compression
bpy.ops.export_scene.gltf(
    filepath="output.glb",
    export_format='GLB',
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6
)
```

## Adding Models to the Viewer

1. Place GLB files in the appropriate system directory
2. Update `src/data/anatomy/bp3dModels.ts` with model metadata:

```typescript
{
  id: 'bp3d_new_model',
  name: 'Model Name',
  format: 'glb',
  url: '/models/bp3d/skeletal/new_model.glb',
  system: 'skeletal',
  region: 'head',
  bp3dId: 'FMA_XXXXX',
  fmaId: 'FMA_XXXXX'
}
```

## Testing Models

Use the development server to test models:

```bash
cd frontend
npm run dev
```

Navigate to the Human Anatomy page and select the system containing your model.

## Troubleshooting

### Model not loading
- Check browser console for errors
- Verify file path is correct
- Ensure GLB file is valid (test in https://gltf-viewer.donmccurdy.com/)

### Model appears black
- Check lighting in scene
- Verify material export settings
- May need to flip normals in Blender

### Model too large/small
- Normalize model scale in Blender before export
- Use the `normalizeModel` function in modelLoader.ts

### Performance issues
- Reduce polygon count
- Enable Draco compression
- Use LOD (Level of Detail) if available

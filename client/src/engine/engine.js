import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createWall,
  createRoom,
  createDoor,
  createWindow,
  createColumn,
  createBeam,
  createArch,
  createPitchedRoof,
  createDome,
  createStairs,
  createColumnWithCapital,
  createBezierSurface,
  parseArchitectureDescription
} from "./architecture-primitives.js";
import HUMAN_PNG_URL from "../assets/human-185.png";

// Note: Using visual representation for doors/windows (frames + transparent panes)
// CSG operations would require additional library installation

export class Engine {
  constructor(container) {
    if (!container) throw new Error("Invalid container");
    this.container = container;
    this._listeners = new Map();

    this.history = [];
    this.redoStack = [];
    this.maxHistory = 100;
    this._t0 = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.camera.position.set(6, 5, 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // CSS3D renderer for HTML elements in 3D space
    this.css3DRenderer = new CSS3DRenderer();
    this.css3DRenderer.setSize(1, 1); // Will resize later
    this.css3DRenderer.domElement.style.position = 'absolute';
    this.css3DRenderer.domElement.style.top = '0';
    this.css3DRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.css3DRenderer.domElement);
    
    this.css3DScene = new THREE.Scene();
    this.feedbackUI = null; // Current 3D feedback UI
    
    // Group editing state (SketchUp-style)
    this.groupEditMode = false; // Are we editing inside a group?
    this.groupEditTarget = null; // The group object being edited
    this.groupEditHistory = []; // Stack of groups being edited (for nested groups later)
    
    // Clipboard for copy/paste
    this._clipboard = null;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);

    this.selectables = [];
    this.selected = null;
    this.selectedSet = new Set(); // for multi-select with shift
    this._transformProxy = null; // group for multi-object transforms
    this._proxyStates = new Map(); // initial states for multi-transform
    this.toolMode = "translate";
    this._billboards = [];

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.scene.add(this.transform.getHelper());
    this._recolorGizmo();
    this.transform.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !e.value;
      
      if (this.selectedSet.size > 1) {
        // multi-object transform
        if (!this.selected) return;
        if (e.value) {
          // start drag: store initial states
          this._multiTransformStart = new Map();
          for (const obj of this.selectedSet) {
            this._multiTransformStart.set(obj, {
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            });
          }
          this._proxyStart = {
            position: this._transformProxy.position.clone(),
            rotation: this._transformProxy.rotation.clone(),
            scale: this._transformProxy.scale.clone(),
          };
        } else {
          // end drag: apply delta to all objects
          if (!this._multiTransformStart) return;
          
          const deltaPos = new THREE.Vector3().subVectors(this._transformProxy.position, this._proxyStart.position);
          const deltaRot = new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion().setFromEuler(this._transformProxy.rotation)
              .multiply(new THREE.Quaternion().setFromEuler(this._proxyStart.rotation).invert())
          );
          const deltaScale = new THREE.Vector3().divideVectors(this._transformProxy.scale, this._proxyStart.scale);
          
          const posBefore = new Map();
          const posAfter = new Map();
          
          for (const obj of this.selectedSet) {
            const initial = this._multiTransformStart.get(obj);
            posBefore.set(obj, {
              position: initial.position.clone(),
              rotation: initial.rotation.clone(),
              scale: initial.scale.clone(),
            });
            
            // Apply delta position
            obj.position.copy(initial.position).add(deltaPos);
            
            // Apply delta rotation
            const qDelta = new THREE.Quaternion().setFromEuler(deltaRot);
            const qInitial = new THREE.Quaternion().setFromEuler(initial.rotation);
            obj.quaternion.copy(qInitial.multiply(qDelta));
            
            // Apply delta scale
            obj.scale.copy(initial.scale).multiply(deltaScale);
            
            posAfter.set(obj, {
              position: obj.position.clone(),
              rotation: new THREE.Euler().setFromQuaternion(obj.quaternion),
              scale: obj.scale.clone(),
            });
          }
          
          // record as single multi-object transform
          this._push({ 
            type: "multi-transform", 
            objects: Array.from(this.selectedSet), 
            before: posBefore, 
            after: posAfter 
          });
          
          this._multiTransformStart = null;
          this._proxyStart = null;
        }
      } else {
        // single object transform
        if (!this.selected) return;
        if (e.value) this._t0 = this._cap(this.selected);
        else {
          const before = this._t0;
          this._t0 = null;
          if (!before) return;
          const after = this._cap(this.selected);
          if (!this._eq(before, after)) this._push({ type: "transform", object: this.selected, before, after });
        }
      }
    });

    // Infinite axes (extremely lightweight - only 2 vertices per line)
    this._addAxes(50000);

    // Outline group
    this._selGroup = new THREE.Group();
    this._selGroup.visible = true;
    this.scene.add(this._selGroup);
    this._outlines = new Map(); // cache outlines per object

    // reusable edge geometry for outlines
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this._outlineMaterials = {
      solid: new THREE.LineBasicMaterial({ color: 0x4b86ff, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false }),
      dashed: (() => {
        const dm = new THREE.LineDashedMaterial({
          color: 0x4b86ff,
          transparent: true,
          opacity: 0.65,
          dashSize: 0.18,
          gapSize: 0.1,
          depthTest: true,
          depthWrite: false,
        });
        dm.depthFunc = THREE.GreaterDepth;
        return dm;
      })(),
    };
    this._edgesGeometry = edges;

    window.addEventListener("resize", () => this._resize());
    
    // Make canvas focusable
    this.renderer.domElement.setAttribute('tabindex', '0');
    this.renderer.domElement.style.outline = 'none'; // Remove focus outline
    
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      // Ensure canvas has focus for keyboard events
      this.renderer.domElement.focus();
      console.log('Canvas focused after click');
      this._pointer(e);
    });
    
    this.renderer.domElement.addEventListener("dblclick", (e) => this._doubleClick(e));
    
    // Attach keydown directly to canvas for better event capture
    this.renderer.domElement.addEventListener("keydown", (e) => {
      console.log('Canvas keydown:', e.key, 'Target:', e.target.tagName);
      this._keys(e);
    });
    
    // Also keep document listener as fallback
    document.addEventListener("keydown", (e) => {
      console.log('Document keydown:', e.key, 'Target:', e.target.tagName, 'Active:', document.activeElement.tagName);
      this._keys(e);
    });
    
    this._resize();

    // ✅ Position adjustment: cube in front, silhouette behind
    const D = 3;  // Distance to axis
    const h = 1.85;  // Silhouette height
    const defaultCube = this.addCube({ x: 1.5, z: -1.5 }); // Cube in front
    const defaultHuman = this.addHuman({ x: -0.5, z: 0.5, h: h }); // Silhouette behind
    // Mark as default scene objects — immune to undo deletion
    defaultCube.userData.isDefault = true;
    defaultHuman.userData.isDefault = true;
    // Clear history so default objects can't be removed with Ctrl+Z
    this.history.length = 0;
    this.redoStack.length = 0;

    this.emit("toolchange", { mode: this.toolMode });
    this._loop();
  }

  // Events
  on(ev, fn) { const s = this._listeners.get(ev) || (this._listeners.set(ev, new Set()), this._listeners.get(ev)); s.add(fn); return () => s.delete(fn); }
  emit(ev, payload) { const s = this._listeners.get(ev); if (s) for (const fn of s) fn(payload); }

  // Loop
  _loop() {
    requestAnimationFrame(() => this._loop());
    this.controls.update();
    this._updateBillboards();
    this._updateFeedbackBillboard(); // Update CSS3D feedback UI to face camera
    
    // update outlines for all selected objects
    this._selGroup.children.length = 0; // clear previous outlines
    
    for (const obj of this.selectedSet) {
      if (!obj?.parent) continue;
      
      // create or reuse outline for this object
      let outline = this._outlines.get(obj);
      if (!outline) {
        const group = new THREE.Group();
        const solid = new THREE.LineSegments(
          this._edgesGeometry,
          this._outlineMaterials.solid
        );
        const dashed = new THREE.LineSegments(
          this._edgesGeometry,
          this._outlineMaterials.dashed
        );
        dashed.computeLineDistances();
        solid.renderOrder = 999;
        dashed.renderOrder = 1000;
        solid.frustumCulled = dashed.frustumCulled = false;
        group.add(solid, dashed);
        outline = group;
        this._outlines.set(obj, outline);
      }
      
      // update outline position/scale to match object
      // For composite objects with children, calc box from children only (exclude invisible parent mesh)
      const box = new THREE.Box3();
      if (obj.userData?.composition && obj.children.length > 0) {
        // Composite object: only include visible children
        obj.children.forEach(child => box.expandByObject(child));
      } else {
        // Simple object or no children: include entire object
        box.setFromObject(obj);
      }
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      
      outline.position.copy(center);
      outline.scale.copy(size);
      this._selGroup.add(outline);
    }
    
    this.renderer.render(this.scene, this.camera);
    this.css3DRenderer.render(this.css3DScene, this.camera);
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.css3DRenderer.setSize(w, h);
  }

  // History helpers
  _cap(o) { return { position: o.position.clone(), rotation: o.rotation.clone(), scale: o.scale.clone() }; }
  _apply(o, s) { o.position.copy(s.position); o.rotation.copy(s.rotation); o.scale.copy(s.scale); }
  _eq(a, b) { return a.position.equals(b.position) && a.scale.equals(b.scale) && a.rotation.x === b.rotation.x && a.rotation.y === b.rotation.y && a.rotation.z === b.rotation.z; }
  _push(a) {
    this.history.push(a);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack.length = 0;
    
    // Also add to object-specific history if it's a transform/add/delete operation
    if (a.type === "transform" && a.object) {
      if (!a.object.userData.history) {
        a.object.userData.history = [];
        a.object.userData.redoStack = [];
      }
      a.object.userData.history.push(a);
      if (a.object.userData.history.length > this.maxHistory) a.object.userData.history.shift();
      a.object.userData.redoStack.length = 0;
      
      // Update feedback UI button states if visible for this object
      if (this.feedbackUI && this.feedbackUI.targetObject === a.object) {
        if (this.feedbackUI.updateButtonStates) {
          this.feedbackUI.updateButtonStates();
        }
      }
    }
    
    // Handle multi-object transforms
    if (a.type === "multi-transform" && a.objects) {
      for (const obj of a.objects) {
        if (!obj.userData.history) {
          obj.userData.history = [];
          obj.userData.redoStack = [];
        }
        obj.userData.history.push(a);
        if (obj.userData.history.length > this.maxHistory) obj.userData.history.shift();
        obj.userData.redoStack.length = 0;
        
        // Update feedback UI button states if visible for any of these objects
        if (this.feedbackUI && this.feedbackUI.targetObject === obj) {
          if (this.feedbackUI.updateButtonStates) {
            this.feedbackUI.updateButtonStates();
          }
        }
      }
    }
  }
  
  // Undo for specific object (used in feedback UI)
  undoObject(object) {
    if (!object || !object.userData.history || object.userData.history.length === 0) return false;
    
    const a = object.userData.history.pop();
    if (!object.userData.redoStack) object.userData.redoStack = [];
    object.userData.redoStack.push(a);
    
    if (a.type === "transform") {
      this._apply(a.object, a.before);
      return true;
    }
    if (a.type === "composition-change") {
      // Restore previous composition
      object.userData.composition = JSON.parse(JSON.stringify(a.before));
      
      // If going back to null composition (simple object), restore original material
      if (!a.before || a.before === null) {
        // Restore original material visibility
        if (object.userData._originalMaterial) {
          object.material = object.userData._originalMaterial;
          object.userData._wasComposite = false;
        }
        
        // Remove all composition children
        while (object.children.length > 0) {
          const child = object.children[0];
          object.remove(child);
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      } else {
        // Normal rebuild from composition
        this._rebuildCompositeVisuals(object);
      }
      
      // Update button states if feedback UI is visible
      if (this.feedbackUI && this.feedbackUI.targetObject === object) {
        if (this.feedbackUI.updateButtonStates) {
          this.feedbackUI.updateButtonStates();
        }
      }
      return true;
    }
    return false;
  }
  
  // Redo for specific object (used in feedback UI)
  redoObject(object) {
    if (!object || !object.userData.redoStack || object.userData.redoStack.length === 0) return false;
    
    const a = object.userData.redoStack.pop();
    if (!object.userData.history) object.userData.history = [];
    object.userData.history.push(a);
    
    if (a.type === "transform") {
      this._apply(a.object, a.after);
      return true;
    }
    if (a.type === "composition-change") {
      // Restore new composition
      object.userData.composition = JSON.parse(JSON.stringify(a.after));
      
      // If going back to null composition (simple object), restore original material
      if (!a.after || a.after === null) {
        // Restore original material visibility
        if (object.userData._originalMaterial) {
          object.material = object.userData._originalMaterial;
          object.userData._wasComposite = false;
        }
        
        // Remove all composition children
        while (object.children.length > 0) {
          const child = object.children[0];
          object.remove(child);
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      } else {
        // Normal rebuild from composition
        this._rebuildCompositeVisuals(object);
      }
      
      // Update button states if feedback UI is visible
      if (this.feedbackUI && this.feedbackUI.targetObject === object) {
        if (this.feedbackUI.updateButtonStates) {
          this.feedbackUI.updateButtonStates();
        }
      }
      return true;
    }
    return false;
  }
  
  // Rebuild composite visuals - removes old meshes and recreates from composition
  _rebuildCompositeVisuals(group) {
    if (!group || !group.userData.composition) return;
    
    // Store original geometry/material if converting to composite for first time
    if (group.geometry && !group.userData._originalGeometry) {
      group.userData._originalGeometry = group.geometry;
      group.userData._originalMaterial = group.material;
      group.userData._wasComposite = true;
    }
    
    // Remove existing children
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
    
    // Hide original geometry with transparent material (keeps geometry for raycasting)
    if (group.userData._originalGeometry) {
      // Create invisible material that preserves raycasting
      group.material = new THREE.MeshStandardMaterial({ 
        transparent: true, 
        opacity: 0,
        depthWrite: false
      });
    }
    
    // Recreate meshes from composition
    for (const part of group.userData.composition) {
      const params = part.params || part;
      const offset = part.offset || { x: part.x || 0, y: part.y || 0, z: part.z || 0 };
      const color = this._parseColor(part.color);
      let mesh;

      switch (part.type) {
        case 'cube':
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(
              params.width || params.size || 1,
              params.height || params.size || 1,
              params.depth || params.size || 1
            ),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'sphere':
          mesh = new THREE.Mesh(
            new THREE.SphereGeometry(params.radius || 1, 32, 32),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'cylinder':
          const r = (params.diameter || params.radius || 1) / 2;
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, params.height || 1, 32),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'cone':
          const coneRadius = params.radius || ((params.diameter || 2) / 2);
          mesh = new THREE.Mesh(
            new THREE.ConeGeometry(coneRadius, params.height || 2, 32),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'torus':
          mesh = new THREE.Mesh(
            new THREE.TorusGeometry(
              params.outerRadius || 0.5,
              params.tubeRadius || 0.15,
              16, 32
            ),
            new THREE.MeshStandardMaterial({ color })
          );
          if (params.axis === 'x') mesh.rotation.y = Math.PI / 2;
          else if (params.axis === 'z') mesh.rotation.x = Math.PI / 2;
          break;
        case 'box':
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(
              params.width || 2,
              params.height || 1,
              params.depth || 1
            ),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'capsule':
          const capsGroup = new THREE.Group();
          const cylHeight = (params.length || 2) - (2 * (params.radius || 0.3));
          const cylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(params.radius || 0.3, params.radius || 0.3, cylHeight, 16),
            new THREE.MeshStandardMaterial({ color })
          );
          const topCap = new THREE.Mesh(
            new THREE.SphereGeometry(params.radius || 0.3, 16, 16),
            new THREE.MeshStandardMaterial({ color })
          );
          const bottomCap = new THREE.Mesh(
            new THREE.SphereGeometry(params.radius || 0.3, 16, 16),
            new THREE.MeshStandardMaterial({ color })
          );
          topCap.position.y = cylHeight / 2;
          bottomCap.position.y = -cylHeight / 2;
          capsGroup.add(cylinder, topCap, bottomCap);
          if (params.axis === 'x') capsGroup.rotation.z = Math.PI / 2;
          else if (params.axis === 'z') capsGroup.rotation.x = Math.PI / 2;
          mesh = capsGroup;
          break;
        case 'triangle':
          mesh = new THREE.Mesh(
            new THREE.ConeGeometry((params.size || 1) / 2, params.size || 1, 3),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'wall':
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(params.width || 1, params.height || 2.5, params.depth || 0.2),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'arch':
          {
            const archMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createArch({
              radius: params.radius || 1.5,
              thickness: params.thickness || 0.2,
              archType: params.archType || 'semicircle',
              segmentCount: params.segmentCount || 16,
              material: archMaterial
            });
          }
          break;
        case 'pitched_roof':
          {
            const roofMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createPitchedRoof({
              width: params.width || 4,
              depth: params.depth || 3,
              height: params.height || 1.5,
              material: roofMaterial
            });
          }
          break;
        case 'dome':
          {
            const domeMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createDome({
              radius: params.radius || 2,
              segments: params.segments || 32,
              material: domeMaterial
            });
          }
          break;
        case 'stairs':
          {
            const stairsMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createStairs({
              width: params.width || 1.2,
              stepCount: params.stepCount || 6,
              stepHeight: params.stepHeight || 0.3,
              stepDepth: params.stepDepth || 0.4,
              includeRailings: params.includeRailings !== false,
              material: stairsMaterial
            });
          }
          break;
        case 'column_with_capital':
          {
            const capitalMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createColumnWithCapital({
              diameter: params.diameter || 0.4,
              height: params.height || 3,
              capitalStyle: params.capitalStyle || 'doric',
              material: capitalMaterial
            });
          }
          break;
        case 'bezier_surface':
          {
            const surfaceMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createBezierSurface({
              controlGrid: params.controlGrid || [
                [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                [[0, 1, 1], [1, 1, 2], [2, 1, 1]],
                [[0, 2, 0], [1, 2, 0], [2, 2, 0]]
              ],
              segments: params.segments || 20,
              material: surfaceMaterial
            });
          }
          break;
        default:
          continue;
      }

      if (mesh) {
        mesh.position.set(offset.x || 0, offset.y || 0, offset.z || 0);
        mesh.userData.compositePart = true;
        group.add(mesh);
      }
    }
  }

  undo() {
    const a = this.history.pop(); if (!a) return;
    this.redoStack.push(a);
    if (a.type === "transform") return this._apply(a.object, a.before);
    if (a.type === "multi-transform") {
      for (const obj of a.objects) {
        const state = a.before.get(obj);
        if (state) this._apply(obj, state);
      }
      return;
    }
    if (a.type === "add") {
      // Protect default objects from being removed by undo
      if (a.object.userData.isDefault) { this.redoStack.pop(); return; }
      this.scene.remove(a.object); 
      a.object.traverse((child) => {
        this._rmSel(child);
        this.selectedSet.delete(child);
      });
      if (this.selected === a.object) this.setSelected(null); 
    }
    if (a.type === "delete") { 
      this.scene.add(a.object); 
      a.object.traverse((child) => this._addSel(child));
    }
    if (a.type === "multi-delete") {
      for (const obj of a.objects) {
        this.scene.add(obj);
        obj.traverse((child) => this._addSel(child));
      }
    }
  }
  redo() {
    const a = this.redoStack.pop(); if (!a) return;
    this.history.push(a);
    if (a.type === "transform") return this._apply(a.object, a.after);
    if (a.type === "multi-transform") {
      for (const obj of a.objects) {
        const state = a.after.get(obj);
        if (state) this._apply(obj, state);
      }
      return;
    }
    if (a.type === "add") { 
      this.scene.add(a.object); 
      a.object.traverse((child) => this._addSel(child));
    }
    if (a.type === "delete") { 
      this.scene.remove(a.object); 
      a.object.traverse((child) => {
        this._rmSel(child);
        this.selectedSet.delete(child);
      });
      if (this.selected === a.object) this.setSelected(null); 
    }
    if (a.type === "multi-delete") {
      for (const obj of a.objects) {
        this.scene.remove(obj);
        obj.traverse((child) => {
          this._rmSel(child);
          this.selectedSet.delete(child);
        });
      }
    }
  }

  // Selection (com multi-select via Shift)
  _pointer(e) {
    if (this.transform.dragging) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.selectables, true);
    let obj = hits.length ? hits[0].object : null;
    while (obj && !obj.userData?.selectable) {
      obj = obj.parent;
    }

    if (e.shiftKey) {
      // multi-select: toggle the group/object in/out of selection
      if (obj) {
        const groupParent = this.getGroupParent(obj);
        
        if (this.selectedSet.has(groupParent)) {
          this.selectedSet.delete(groupParent);
        } else {
          this.selectedSet.add(groupParent);
        }
        // set as primary selected for transformation
        this.setSelected(groupParent, true);
      }
    } else {
      // normal select: clear previous and select this object/group
      this.selectedSet.clear();
      if (obj) {
        // Get the group parent if this object is part of a group
        const groupParent = this.getGroupParent(obj);
        console.log(`🎯 Selected in ${this.groupEditMode ? 'GROUP EDIT' : 'NORMAL'} mode:`, groupParent.type, groupParent.name);
        this.selectedSet.add(groupParent);
      }
      this.setSelected(obj ? this.getGroupParent(obj) : null, false);
    }
  }

  setSelected(obj, keepOthers = false) {
    if (!keepOthers) {
      this.selectedSet.clear();
      if (obj) this.selectedSet.add(obj);
    }
    
    this.selected = obj;
    this.transform.detach();
    
    // Hide any existing feedback UI
    this.hideFeedbackUI();
    
    // Show feedback UI for any object (composite or simple)
    if (obj) {
      this.showFeedbackUI(obj);
    }

    // if multiple objects selected, create a proxy for grouped transformation
    if (this.selectedSet.size > 1) {
      // create or update proxy
      if (!this._transformProxy) {
        this._transformProxy = new THREE.Group();
        this._transformProxy.name = "transform-proxy";
        this.scene.add(this._transformProxy);
      }

      // calculate center of all selected objects
      const box = new THREE.Box3();
      for (const o of this.selectedSet) {
        box.expandByObject(o);
      }
      const center = new THREE.Vector3();
      box.getCenter(center);

      // position proxy at center
      this._transformProxy.position.copy(center);
      this._transformProxy.rotation.set(0, 0, 0);
      this._transformProxy.scale.set(1, 1, 1);

      // store initial state of all selected objects relative to proxy
      this._proxyStates.clear();
      for (const o of this.selectedSet) {
        this._proxyStates.set(o, {
          position: o.position.clone(),
          rotation: o.rotation.clone(),
          scale: o.scale.clone(),
        });
      }

      // attach transform to proxy
      if (this.toolMode !== "select") {
        this.transform.attach(this._transformProxy);
        this.transform.setMode(this.toolMode);
      }
    } else {
      // single object or none selected
      if (this._transformProxy && this.selectedSet.size === 0) {
        this.scene.remove(this._transformProxy);
        this._transformProxy = null;
        this._proxyStates.clear();
      }

      // attach transform directly to selected object
      if (obj && this.toolMode !== "select") {
        this.transform.attach(obj);
        this.transform.setMode(this.toolMode);
      }
    }

    this.emit("selectionchange", { selected: this.selected, selectedSet: this.selectedSet });
  }

  _doubleClick(e) {
    // Double-click on a composite object to enter group editing mode
    if (this.transform.dragging) return;
    
    const r = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.selectables, true);
    let obj = hits.length ? hits[0].object : null;
    
    while (obj && !obj.userData?.selectable) {
      obj = obj.parent;
    }
    
    // Look for a composite object - check obj itself or traverse up to find composite parent
    let compositeObj = obj;
    while (compositeObj && compositeObj !== this.scene) {
      if (compositeObj.userData?.composition && compositeObj.userData.composition.length > 0) {
        this.enterGroupEdit(compositeObj);
        return;
      }
      compositeObj = compositeObj.parent;
    }
  }

  setTool(mode) {
    if (this.toolMode === mode) return;
    this.toolMode = mode;
    if (mode === "select") {
      this.transform.detach();
    } else if (this.selected) {
      if (this.selectedSet.size > 1 && this._transformProxy) {
        // attach to proxy for multi-object transform
        this.transform.attach(this._transformProxy);
      } else {
        // attach to single selected object
        this.transform.attach(this.selected);
      }
      this.transform.setMode(mode);
    }
    this.emit("toolchange", { mode });
  }

  // Enter group editing mode (SketchUp-style)
  enterGroupEdit(groupObject) {
    if (!groupObject.userData?.composition || groupObject.userData.composition.length === 0) {
      console.warn('enterGroupEdit: object is not a composite');
      return;
    }

    // Push this group onto the editing stack
    this.groupEditHistory.push(groupObject);
    this.groupEditMode = true;
    this.groupEditTarget = groupObject;

    // Store original selection
    const wasSelected = new Set(this.selectedSet);

    // Clear selection and deselect all
    this.selectedSet.clear();
    this.setSelected(null);

    // Remove the group itself from selectables temporarily
    this._rmSel(groupObject);

    // Make only direct children (composition parts) selectable
    // Use .children instead of .traverse() to avoid nested meshes (e.g., capsule internal geometry)
    for (const child of groupObject.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Group || child.userData?.compositePart) {
        child.userData.isInGroupEdit = true;
        child.userData.selectable = true;
        this._addSel(child); // Add to selectables array
      }
    }

    console.log(`✏️ Entered group editing mode for "${groupObject.userData.compositeName || groupObject.name}"`);
    this.emit('groupedit:enter', { target: groupObject });
  }

  // Exit group editing mode
  exitGroupEdit() {
    if (!this.groupEditMode || this.groupEditHistory.length === 0) {
      console.warn('exitGroupEdit: not in group editing mode');
      return;
    }

    const groupObject = this.groupEditHistory.pop();
    this.groupEditMode = this.groupEditHistory.length > 0;
    this.groupEditTarget = this.groupEditHistory[this.groupEditHistory.length - 1] || null;

    // Remove group edit flag from direct children only
    // Use .children instead of .traverse() to match how we entered
    for (const child of groupObject.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Group || child.userData?.compositePart) {
        child.userData.isInGroupEdit = false;
        // Only remove selectable if it was a composite part (not a manually created group member)
        if (child.userData?.compositePart) {
          child.userData.selectable = false;
          this._rmSel(child); // Remove from selectables array
        }
      }
    }

    // Re-add the group itself to selectables
    this._addSel(groupObject);

    // Select the group again
    this.setSelected(groupObject);

    console.log(`✅ Exited group editing mode for "${groupObject.userData.compositeName || groupObject.name}"`);
    this.emit('groupedit:exit', { target: groupObject });
  }

  getGroupMembers(obj) {
    // If object itself is a composite group, return all its children
    if (obj && obj.userData?.isComposite) {
      return obj.children.filter(child => child.userData?.selectable);
    }
    // If object's parent is a composite group, return all group members (siblings)
    if (obj && obj.parent && obj.parent.userData?.isComposite) {
      return obj.parent.children.filter(child => child.userData?.selectable);
    }
    // Not a group and not part of a group, return just the object
    return obj ? [obj] : [];
  }

  getGroupParent(obj) {
    // If in group edit mode, NEVER return the parent - always work with direct objects
    if (this.groupEditMode) {
      return obj;
    }
    
    // If object is part of a composite group, return the group
    if (obj && obj.parent && obj.parent.userData?.isComposite) {
      return obj.parent;
    }
    // If object itself is a composite group, return it
    if (obj && obj.userData?.isComposite) {
      return obj;
    }
    // Not part of a group, return the object itself
    return obj;
  }

  createGroup() {
    // Get all selected objects
    const selectedObjects = Array.from(this.selectedSet);
    
    if (selectedObjects.length < 2) {
      console.warn('Cannot create group: need at least 2 objects selected');
      return;
    }
    
    // Create a parent group object
    const groupObject = new THREE.Group();
    groupObject.name = `Group_${Date.now()}`;
    groupObject.userData.selectable = true;
    groupObject.userData.composition = [];
    groupObject.userData.isComposite = true;
    groupObject.userData.compositeName = `Group ${selectedObjects.length} items`;
    
    // Find common parent (should be scene if selection from different parents)
    let commonParent = selectedObjects[0].parent;
    const allSameParent = selectedObjects.every(obj => obj.parent === commonParent);
    if (!allSameParent) {
      commonParent = this.scene;
    }
    
    // Add group to scene/parent and to selectables
    commonParent.add(groupObject);
    this._addSel(groupObject); // Add to selectables so it can be picked
    
    // Reparent selected objects to the group
    selectedObjects.forEach(obj => {
      groupObject.add(obj);
      groupObject.userData.composition.push(obj);
    });
    
    // Save state for undo using the proper undo system
    this._push({ type: 'group', objects: selectedObjects, group: groupObject });
    
    // Clear selection and select the group
    this.selectedSet.clear();
    this.setSelected(groupObject);
    
    console.log(`✅ Created group with ${selectedObjects.length} objects`);
    this.emit('group:created', { group: groupObject, objects: selectedObjects });
  }

  copyObject() {
    if (!this.selected) {
      console.warn('Cannot copy: no object selected');
      return;
    }
    
    // Store the selected object data in clipboard
    this._clipboard = {
      object: this.selected.clone(),
      userData: JSON.parse(JSON.stringify(this.selected.userData)),
      position: this.selected.position.clone(),
      rotation: this.selected.rotation.clone(),
      scale: this.selected.scale.clone()
    };
    
    console.log('✅ Object copied to clipboard');
  }

  pasteObject() {
    if (!this._clipboard) {
      console.warn('Cannot paste: clipboard is empty');
      return;
    }
    
    // Clone the object from clipboard
    const newObject = this._clipboard.object.clone();
    newObject.userData = JSON.parse(JSON.stringify(this._clipboard.userData));
    
    // Offset position slightly so it's visible
    newObject.position.copy(this._clipboard.position).add(new THREE.Vector3(0.5, 0, 0.5));
    newObject.rotation.copy(this._clipboard.rotation);
    newObject.scale.copy(this._clipboard.scale);
    
    // Add to scene
    this.scene.add(newObject);
    this._addSel(newObject);
    this._push({ type: 'add', object: newObject });
    
    // Select the pasted object
    this._deselAll();
    this._sel(newObject);
    this.setSelected(newObject);
    
    console.log('✅ Object pasted');
  }

  duplicateObject() {
    if (!this.selected) {
      console.warn('Cannot duplicate: no object selected');
      return;
    }
    
    // Clone the selected object
    const newObject = this.selected.clone();
    newObject.userData = JSON.parse(JSON.stringify(this.selected.userData));
    
    // Offset position slightly so it's visible
    newObject.position.copy(this.selected.position).add(new THREE.Vector3(0.5, 0, 0.5));
    
    // Add to scene
    this.scene.add(newObject);
    this._addSel(newObject);
    this._push({ type: 'add', object: newObject });
    
    // Select the duplicated object
    this._deselAll();
    this._sel(newObject);
    this.setSelected(newObject);
    
    console.log('✅ Object duplicated');
  }

  _keys(e) {
    const el = document.activeElement;
    const target = e.target;
    const tag = el?.tagName?.toLowerCase();
    const targetTag = target?.tagName?.toLowerCase();
    const isTypingInField =
      tag === "input" ||
      tag === "textarea" ||
      el?.isContentEditable ||
      targetTag === "input" ||
      targetTag === "textarea" ||
      target?.isContentEditable;

    if (isTypingInField) return;

    const isDeleteKey = e.key === "Delete" || e.key === "Backspace";

    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z") return e.preventDefault(), this.undo();
    if (mod && k === "y") return e.preventDefault(), this.redo();
    if (mod && k === "c") return e.preventDefault(), this.copyObject();
    if (mod && k === "v") return e.preventDefault(), this.pasteObject();
    if (k === "m") return this.setTool("translate");
    if (k === "r") return this.setTool("rotate");
    if (k === "s") return this.setTool("scale");
    if (e.key === " ") {
      // Space bar: switch to select tool or exit group edit mode
      if (this.groupEditMode) {
        return this.exitGroupEdit();
      }
      return this.setTool("select");
    }
    if (e.key === "Escape") {
      // Escape: exit group edit mode
      if (this.groupEditMode) {
        return this.exitGroupEdit();
      }
    }
    if (k === "g") return this.exportGLB();

    console.log(`Key pressed: "${e.key}", isDeleteKey: ${isDeleteKey}, this.selected:`, this.selected);
    
    if (isDeleteKey && this.selected) {
      e.preventDefault();
      const toDelete = Array.from(this.selectedSet);
      const deletedObjects = [];
      
      console.log(`🗑️ Attempting to delete ${toDelete.length} object(s), groupEditMode: ${this.groupEditMode}`);
      
      for (let obj of toDelete) {
        console.log(`  - Deleting object:`, obj.type, obj.name, 'parent:', obj.parent?.type);
        
        // When in group edit mode, delete the object directly without traversing to parent
        if (!this.groupEditMode) {
          // Normal mode: traverse up to find root parent
          while (obj.parent && obj.parent !== this.scene) {
            obj = obj.parent;
          }
        }
        
        if (!deletedObjects.includes(obj)) {
          deletedObjects.push(obj);
          
          // If in group edit mode and parent has composition array, remove from it
          if (this.groupEditMode && obj.parent && obj.parent.userData?.composition) {
            const idx = obj.parent.userData.composition.indexOf(obj);
            if (idx !== -1) {
              obj.parent.userData.composition.splice(idx, 1);
              console.log(`    ✓ Removed from parent composition array (${obj.parent.userData.composition.length} remaining)`);
            }
          }
          
          // Remove from its parent (either scene or group)
          if (obj.parent) {
            obj.parent.remove(obj);
          }
          obj.traverse((child) => {
            this._rmSel(child);
            this.selectedSet.delete(child);
          });
        }
      }
      
      console.log(`✓ Deleted ${deletedObjects.length} object(s)`);

      if (deletedObjects.length > 1) {
        this._push({ type: "multi-delete", objects: deletedObjects });
      } else if (deletedObjects.length === 1) {
        this._push({ type: "delete", object: deletedObjects[0] });
      }
      
      this.setSelected(null);
    }
  }

  _addSel(o) { if (o?.userData?.selectable && !this.selectables.includes(o)) this.selectables.push(o); }
  _rmSel(o) { const i = this.selectables.indexOf(o); if (i !== -1) this.selectables.splice(i, 1); }

  // Objects
  addCube({ x = 0, z = 0, size = 2 } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color: 0x9aa3b2 }));
    mesh.position.set(x, size / 2, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // simple parametric wall - width along x, depth along z
  addWall({ width = 1, height = 2.5, depth = 0.2, x = 0, z = 0 } = {}) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + width / 2, height / 2, z + depth / 2);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // simple cylinder helper along Y axis
  addCylinder({ diameter = 2, height = 2, x = 0, z = 0 } = {}) {
    const radius = diameter / 2;
    const geo = new THREE.CylinderGeometry(radius, radius, height, 32);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height / 2, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // triangular prism helper (wedge shape)
  addTriangle({ size = 2, x = 0, z = 0 } = {}) {
    const width = size;
    const height = size;
    const depth = size;
    
    const vertices = new Float32Array([
      // Front triangular face
      -width / 2, 0, depth / 2,        // 0 bottom-left
       width / 2, 0, depth / 2,        // 1 bottom-right
       0, height, depth / 2,           // 2 top
      
      // Back triangular face
      -width / 2, 0, -depth / 2,       // 3 bottom-left
       width / 2, 0, -depth / 2,       // 4 bottom-right
       0, height, -depth / 2,          // 5 top
    ]);
    
    const indices = new Uint16Array([
      // Front face
      0, 1, 2,
      // Back face
      4, 3, 5,
      // Bottom face
      3, 4, 1, 3, 1, 0,
      // Left slope
      3, 0, 2, 3, 2, 5,
      // Right slope
      1, 4, 5, 1, 5, 2
    ]);
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // sphere helper
  addSphere({ radius = 1, x = 0, y = 0, z = 0 } = {}) {
    const geo = new THREE.SphereGeometry(radius, 32, 32);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + radius, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // cone helper
  addCone({ radius = 1, height = 2, x = 0, z = 0 } = {}) {
    const geo = new THREE.ConeGeometry(radius, height, 32);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height / 2, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // torus helper - perfect for wheels/tires
  addTorus({ outerRadius = 0.5, tubeRadius = 0.15, x = 0, y = 0, z = 0, axis = 'x' } = {}) {
    const geo = new THREE.TorusGeometry(outerRadius, tubeRadius, 16, 32);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Rotate based on axis (torus default is Y axis, rotate for X or Z)
    if (axis === 'x') {
      mesh.rotation.y = Math.PI / 2;
    } else if (axis === 'z') {
      mesh.rotation.x = Math.PI / 2;
    }
    
    mesh.position.set(x, y + outerRadius + tubeRadius, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // box helper - like cube but with separate dimensions (better for vehicles, furniture)
  addBox({ width = 2, height = 1, depth = 1, x = 0, y = 0, z = 0 } = {}) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + height / 2, z);
    mesh.userData.selectable = true;
    this.scene.add(mesh);
    this._addSel(mesh);
    this._push({ type: "add", object: mesh });
    return mesh;
  }

  // capsule helper - cylinder with rounded ends (better for smooth shapes)
  addCapsule({ radius = 0.3, length = 2, x = 0, y = 0, z = 0, axis = 'y' } = {}) {
    const group = new THREE.Group();
    
    // Create cylinder body
    const cylinderHeight = length - (2 * radius);
    const cylinderGeo = new THREE.CylinderGeometry(radius, radius, cylinderHeight, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
    const cylinder = new THREE.Mesh(cylinderGeo, mat);
    
    // Create sphere caps
    const sphereGeo = new THREE.SphereGeometry(radius, 16, 16);
    const topCap = new THREE.Mesh(sphereGeo, mat);
    const bottomCap = new THREE.Mesh(sphereGeo, mat);
    
    topCap.position.y = cylinderHeight / 2;
    bottomCap.position.y = -cylinderHeight / 2;
    
    group.add(cylinder);
    group.add(topCap);
    group.add(bottomCap);
    
    // Rotate based on axis
    if (axis === 'x') {
      group.rotation.z = Math.PI / 2;
    } else if (axis === 'z') {
      group.rotation.x = Math.PI / 2;
    }
    
    group.position.set(x, y + Math.max(radius, length / 2), z);
    group.userData.selectable = true;
    this.scene.add(group);
    this._addSel(group);
    this._push({ type: "add", object: group });
    return group;
  }

  // Helper: convert color string/name to THREE.js color value
  _parseColor(colorValue) {
    if (!colorValue) return 0x9aa3b2; // default gray
    if (typeof colorValue === 'number') return colorValue; // already a number
    // Handle hex strings like "#ff0000" or "ff0000"
    if (typeof colorValue === 'string') {
      const hex = colorValue.replace('#', '').toLowerCase();
      // Common color names in Portuguese and English
      const colorNames = {
        'red': 0xff0000, 'vermelho': 0xff0000, 'verde': 0x00ff00, 'green': 0x00ff00, 
        'blue': 0x0000ff, 'azul': 0x0000ff, 'yellow': 0xffff00, 'amarelo': 0xffff00,
        'cyan': 0x00ffff, 'magenta': 0xff00ff, 'white': 0xffffff, 'branco': 0xffffff,
        'black': 0x000000, 'preto': 0x000000, 'gray': 0x808080, 'cinza': 0x808080,
        'orange': 0xff8800, 'laranja': 0xff8800, 'purple': 0x800080, 'roxo': 0x800080,
        'pink': 0xff69b4, 'rosa': 0xff69b4, 'brown': 0x8b4513, 'castanho': 0x8b4513,
        'gold': 0xffd700, 'ouro': 0xffd700, 'silver': 0xc0c0c0, 'prata': 0xc0c0c0
      };
      if (colorNames[hex]) return colorNames[hex];
      // Try to parse as hex
      try {
        return parseInt('0x' + hex.substring(0, 6), 16);
      } catch (e) {
        return 0x9aa3b2; // fallback gray
      }
    }
    return 0x9aa3b2; // default
  }

  // composite helper - creates group of primitives (learned objects like tree, chair, etc.)
  addComposite({ composition = [], x = 0, z = 0, name = 'composite' } = {}) {
    const group = new THREE.Group();
    group.userData.selectable = true;
    group.userData.compositeName = name;
    group.userData.composition = composition; // Save for feedback

    for (const part of composition) {
      const params = part.params || part;
      const offset = part.offset || { x: part.x || 0, y: part.y || 0, z: part.z || 0 };
      const color = this._parseColor(part.color);
      let mesh;

      switch (part.type) {
        case 'cube':
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(
              params.width || params.size || 1,
              params.height || params.size || 1,
              params.depth || params.size || 1
            ),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'cylinder':
          const r = (params.diameter || params.radius || 1) / 2;
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, params.height || 1, 32),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'sphere':
          mesh = new THREE.Mesh(
            new THREE.SphereGeometry(params.radius || 1, 32, 32),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'cone':
          {
          const coneRadius = params.radius || ((params.diameter || 2) / 2);
          mesh = new THREE.Mesh(
            new THREE.ConeGeometry(coneRadius, params.height || 2, 32),
            new THREE.MeshStandardMaterial({ color })
          );
          }
          break;
        case 'triangle':
          mesh = new THREE.Mesh(
            new THREE.ConeGeometry((params.size || 1) / 2, params.size || 1, 3),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'torus':
          mesh = new THREE.Mesh(
            new THREE.TorusGeometry(
              params.outerRadius || 0.5,
              params.tubeRadius || 0.15,
              16, 32
            ),
            new THREE.MeshStandardMaterial({ color })
          );
          if (params.axis === 'x') mesh.rotation.y = Math.PI / 2;
          else if (params.axis === 'z') mesh.rotation.x = Math.PI / 2;
          break;
        case 'box':
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(
              params.width || 2,
              params.height || 1,
              params.depth || 1
            ),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'capsule':
          {
            const capsGroup = new THREE.Group();
            const cylHeight = (params.length || 2) - (2 * (params.radius || 0.3));
            const cylinder = new THREE.Mesh(
              new THREE.CylinderGeometry(params.radius || 0.3, params.radius || 0.3, cylHeight, 16),
              new THREE.MeshStandardMaterial({ color })
            );
            const topCap = new THREE.Mesh(
              new THREE.SphereGeometry(params.radius || 0.3, 16, 16),
              new THREE.MeshStandardMaterial({ color })
            );
            const bottomCap = new THREE.Mesh(
              new THREE.SphereGeometry(params.radius || 0.3, 16, 16),
              new THREE.MeshStandardMaterial({ color })
            );
            topCap.position.y = cylHeight / 2;
            bottomCap.position.y = -cylHeight / 2;
            capsGroup.add(cylinder, topCap, bottomCap);
            if (params.axis === 'x') capsGroup.rotation.z = Math.PI / 2;
            else if (params.axis === 'z') capsGroup.rotation.x = Math.PI / 2;
            mesh = capsGroup;
          }
          break;
        case 'wall':
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(params.width || 1, params.height || 2.5, params.depth || 0.2),
            new THREE.MeshStandardMaterial({ color })
          );
          break;
        case 'arch':
          {
            const archMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createArch({
              radius: params.radius || 1.5,
              thickness: params.thickness || 0.2,
              archType: params.archType || 'semicircle',
              segmentCount: params.segmentCount || 16,
              material: archMaterial
            });
          }
          break;
        case 'pitched_roof':
          {
            const roofMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createPitchedRoof({
              width: params.width || 4,
              depth: params.depth || 3,
              height: params.height || 1.5,
              material: roofMaterial
            });
          }
          break;
        case 'dome':
          {
            const domeMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createDome({
              radius: params.radius || 2,
              segments: params.segments || 32,
              material: domeMaterial
            });
          }
          break;
        case 'stairs':
          {
            const stairsMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createStairs({
              width: params.width || 1.2,
              stepCount: params.stepCount || 6,
              stepHeight: params.stepHeight || 0.3,
              stepDepth: params.stepDepth || 0.4,
              includeRailings: params.includeRailings !== false,
              material: stairsMaterial
            });
          }
          break;
        case 'column_with_capital':
          {
            const capitalMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createColumnWithCapital({
              diameter: params.diameter || 0.4,
              height: params.height || 3,
              capitalStyle: params.capitalStyle || 'doric',
              material: capitalMaterial
            });
          }
          break;
        case 'bezier_surface':
          {
            const surfaceMaterial = color ? new THREE.MeshStandardMaterial({ color }) : undefined;
            mesh = createBezierSurface({
              controlGrid: params.controlGrid || [
                [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                [[0, 1, 1], [1, 1, 2], [2, 1, 1]],
                [[0, 2, 0], [1, 2, 0], [2, 2, 0]]
              ],
              segments: params.segments || 20,
              material: surfaceMaterial
            });
          }
          break;
        default:
          console.warn(`Unknown composite part type: ${part.type}`);
          continue;
      }

      if (mesh) {
        mesh.position.set(offset.x || 0, offset.y || 0, offset.z || 0);
        mesh.userData.compositePart = true;
        group.add(mesh);
      }
    }

    group.position.set(x, 0, z);
    this.scene.add(group);
    this._addSel(group);
    this._push({ type: "add", object: group });
    
    return group;
  }

  /**
   * ARCHITECTURE-SPECIFIC BUILDERS (with semantic understanding)
   */

  addArchitectureWall({ width = 4, height = 3, thickness = 0.3, doors = [], windows = [], x = 0, z = 0 } = {}) {
    const wall = createWall({ width, height, thickness, doors, windows });
    wall.position.set(x, 0, z);
    wall.userData.selectable = true;
    wall.userData.type = 'Wall';
    wall.userData.params = { width, height, thickness, doors, windows };
    this.scene.add(wall);
    this._addSel(wall);
    this._push({ type: "add", object: wall });
    return wall;
  }

  addArchitectureRoom({ width = 5, depth = 4, height = 3, thickness = 0.3, doors = {}, windows = {}, x = 0, z = 0 } = {}) {
    const room = createRoom({ width, depth, height, thickness, doors, windows });
    room.position.set(x, 0, z);
    room.userData.selectable = true;
    room.userData.type = 'Room';
    room.userData.params = { width, depth, height, thickness, doors, windows };
    this.scene.add(room);
    this._addSel(room);
    this._push({ type: "add", object: room });
    return room;
  }

  addArchitectureDoor({ width = 1, height = 2.1, x = 0, z = 0 } = {}) {
    const door = createDoor({ width, height });
    door.position.set(x, 0, z);
    door.userData.selectable = true;
    door.userData.type = 'Door';
    door.userData.params = { width, height };
    this.scene.add(door);
    this._addSel(door);
    this._push({ type: "add", object: door });
    return door;
  }

  addArchitectureWindow({ width = 1.2, height = 1, x = 0, z = 0 } = {}) {
    const window = createWindow({ width, height });
    window.position.set(x, 1.2, z);
    window.userData.selectable = true;
    window.userData.type = 'Window';
    window.userData.params = { width, height };
    this.scene.add(window);
    this._addSel(window);
    this._push({ type: "add", object: window });
    return window;
  }

  addColumn({ diameter = 0.4, height = 3, x = 0, z = 0 } = {}) {
    const column = createColumn({ diameter, height });
    column.position.set(x, 0, z);
    column.userData.selectable = true;
    column.userData.type = 'Column';
    column.userData.params = { diameter, height };
    this.scene.add(column);
    this._addSel(column);
    this._push({ type: "add", object: column });
    return column;
  }

  addBeam({ length = 5, height = 0.3, depth = 0.4, x = 0, y = 0, z = 0 } = {}) {
    const beam = createBeam({ length, height, depth });
    beam.position.set(x, y, z);
    beam.userData.selectable = true;
    beam.userData.type = 'Beam';
    beam.userData.params = { length, height, depth };
    this.scene.add(beam);
    this._addSel(beam);
    this._push({ type: "add", object: beam });
    return beam;
  }

  addArch({ radius = 1.5, thickness = 0.2, archType = 'semicircle', x = 0, z = 0 } = {}) {
    const arch = createArch({ radius, thickness, archType });
    arch.position.set(x, 0, z);
    arch.userData.selectable = true;
    arch.userData.type = 'Arch';
    arch.userData.params = { radius, thickness, archType };
    this.scene.add(arch);
    this._addSel(arch);
    this._push({ type: "add", object: arch });
    return arch;
  }

  addRoof({ width = 4, depth = 3, height = 1.5, x = 0, z = 0 } = {}) {
    const roof = createPitchedRoof({ width, depth, height });
    roof.position.set(x, 0, z);
    roof.userData.selectable = true;
    roof.userData.type = 'Roof';
    roof.userData.params = { width, depth, height };
    this.scene.add(roof);
    this._addSel(roof);
    this._push({ type: "add", object: roof });
    return roof;
  }

  addStair({ width = 1.2, stepCount = 6, stepHeight = 0.3, stepDepth = 0.4, x = 0, z = 0 } = {}) {
    const stair = createStairs({ width, stepCount, stepHeight, stepDepth });
    stair.position.set(x, 0, z);
    stair.userData.selectable = true;
    stair.userData.type = 'Stair';
    stair.userData.params = { width, stepCount, stepHeight, stepDepth };
    this.scene.add(stair);
    this._addSel(stair);
    this._push({ type: "add", object: stair });
    return stair;
  }

  addDome({ radius = 2, x = 0, z = 0 } = {}) {
    const dome = createDome({ radius });
    dome.position.set(x, 0, z);
    dome.userData.selectable = true;
    dome.userData.type = 'Dome';
    dome.userData.params = { radius };
    this.scene.add(dome);
    this._addSel(dome);
    this._push({ type: "add", object: dome });
    return dome;
  }

  addColumnWithCapital({ diameter = 0.4, height = 3, capitalType = 'ionic', x = 0, z = 0 } = {}) {
    const column = createColumnWithCapital({ diameter, height, capitalType });
    column.position.set(x, 0, z);
    column.userData.selectable = true;
    column.userData.type = 'ColumnWithCapital';
    column.userData.params = { diameter, height, capitalType };
    this.scene.add(column);
    this._addSel(column);
    this._push({ type: "add", object: column });
    return column;
  }

  // Show 3D feedback UI attached to any selected object
  showFeedbackUI(object) {
    if (!object) return;
    
    try {
      // Get object name (composite or simple type)
      const objName = object.userData.compositeName || object.userData.type || object.name || 'object';
      const isHuman = object.userData.isHuman === true;
      
      // Create HTML element for feedback
      const feedbackDiv = document.createElement('div');
      feedbackDiv.className = 'feedback-3d';
      
      // Check if object is composite
      const isComposite = object.userData?.composition && object.userData.composition.length > 0;
      
      // Build HTML based on whether it's a human silhouette
      if (isHuman) {
        // For human silhouette: only show toolbar (delete, undo, redo)
        feedbackDiv.innerHTML = `
          <div class="feedback-3d-container">
            <div class="feedback-3d-toolbar">
              <button class="feedback-btn feedback-btn-undo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
              <button class="feedback-btn feedback-btn-redo" title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
              <button class="feedback-btn feedback-btn-delete" title="Delete (Delete)" aria-label="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
              <div class="feedback-dropdown-container">
                <button class="feedback-btn feedback-btn-dropdown" title="More options" aria-label="More options"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                <div class="feedback-dropdown-menu">
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        // For regular objects: show full toolbar with rating buttons and input
        feedbackDiv.innerHTML = `
          <div class="feedback-3d-container">
            <div class="feedback-rating-buttons">
              <button class="feedback-btn feedback-btn-thumbsup" title="Good job!" aria-label="Thumbs Up" data-rating="positive"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></button>
              <button class="feedback-btn feedback-btn-thumbsdown" title="Needs improvement" aria-label="Thumbs Down" data-rating="negative"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg></button>
            </div>
            <input type="text" 
                   class="feedback-3d-input" 
                   placeholder="Edit/Improve ${objName}..." 
                   />
            <div class="feedback-3d-toolbar">
              <button class="feedback-btn feedback-btn-undo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
              <button class="feedback-btn feedback-btn-redo" title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
              <button class="feedback-btn feedback-btn-delete" title="Delete (Delete)" aria-label="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
              <div class="feedback-dropdown-container">
                <button class="feedback-btn feedback-btn-dropdown" title="More options" aria-label="More options"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                <div class="feedback-dropdown-menu">
                </div>
              </div>
            </div>
          </div>
        `;
      }
      
      // Enable pointer events
      feedbackDiv.style.pointerEvents = 'auto';
      
      const input = feedbackDiv.querySelector('.feedback-3d-input');
      const undoBtn = feedbackDiv.querySelector('.feedback-btn-undo');
      const redoBtn = feedbackDiv.querySelector('.feedback-btn-redo');
      const deleteBtn = feedbackDiv.querySelector('.feedback-btn-delete');
      const thumbsUpBtn = feedbackDiv.querySelector('.feedback-btn-thumbsup');
      const thumbsDownBtn = feedbackDiv.querySelector('.feedback-btn-thumbsdown');
      
      // Safety checks (for human silhouette, rating buttons and input are not present)
      if (!undoBtn || !redoBtn || !deleteBtn) {
        console.error('❌ Failed to create feedback UI elements');
        return;
      }
      
      if (!isHuman && (!input || !thumbsUpBtn || !thumbsDownBtn)) {
        console.error('❌ Failed to create feedback rating/input UI elements');
        return;
      }
      
      // Track rating state (only for non-human objects)
      let currentRating = null; // null, 'positive', or 'negative'
      
      // Update button states based on object-specific undo/redo stacks
      const updateButtonStates = () => {
        // Update undo/redo buttons independently
        if (undoBtn && redoBtn) {
          const hasHistory = object.userData.history && object.userData.history.length > 0;
          const hasRedo = object.userData.redoStack && object.userData.redoStack.length > 0;
          undoBtn.disabled = !hasHistory;
          redoBtn.disabled = !hasRedo;
        }
        
        // Update rating buttons independently (only for non-human objects)
        if (!isHuman && thumbsUpBtn && thumbsDownBtn) {
          const isComposite = object.userData.composition && object.userData.composition.length > 0;
          // Check if object has been improved (composition-change in history) - not just moved (transform)
          const hasBeenImproved = object.userData.history && object.userData.history.some(entry => entry.type === "composition-change");
          // Enable rating only if object was created (composite) or been improved via feedback
          const canRate = isComposite || hasBeenImproved;
          thumbsUpBtn.disabled = !canRate;
          thumbsDownBtn.disabled = !canRate;
        }
      };
    
    // Button click handlers - call object-specific undo/redo
    undoBtn.addEventListener('click', () => {
      this.undoObject(object);
      updateButtonStates();
    });
    
    redoBtn.addEventListener('click', () => {
      this.redoObject(object);
      updateButtonStates();
    });
    
    deleteBtn.addEventListener('click', () => {
      let objToDelete = object;
      
      // When in group edit mode, delete the object directly without traversing to parent
      if (!this.groupEditMode) {
        // Normal mode: traverse up to find root parent
        while (objToDelete.parent && objToDelete.parent !== this.scene) {
          objToDelete = objToDelete.parent;
        }
      }
      
      // If in group edit mode and parent has composition array, remove from it
      if (this.groupEditMode && objToDelete.parent && objToDelete.parent.userData?.composition) {
        const idx = objToDelete.parent.userData.composition.indexOf(objToDelete);
        if (idx !== -1) {
          objToDelete.parent.userData.composition.splice(idx, 1);
          console.log(`    ✓ Removed from parent composition array (${objToDelete.parent.userData.composition.length} remaining)`);
        }
      }
      
      // Remove from its parent (either scene or group)
      if (objToDelete.parent) {
        objToDelete.parent.remove(objToDelete);
      }
      
      // Clean up all children
      objToDelete.traverse((child) => {
        this._rmSel(child);
        this.selectedSet.delete(child);
      });
      
      // Record in history
      this._push({ type: "delete", object: objToDelete });
      
      // Update selection
      this.setSelected(null);
      
      // Close feedback UI
      this.hideFeedbackUI();
    });
    
    // Handle rating button clicks (only for non-human objects)
    if (!isHuman) {
      thumbsUpBtn.addEventListener('click', () => {
        if (thumbsUpBtn.disabled) return;
        if (currentRating === 'positive') {
          // Deselect
          currentRating = null;
          thumbsUpBtn.style.opacity = '';
          thumbsUpBtn.style.background = '';
        } else {
          // Select thumbs up
          currentRating = 'positive';
          thumbsUpBtn.style.opacity = '1';
          thumbsUpBtn.style.background = 'rgba(76, 175, 80, 0.3)';
          thumbsDownBtn.style.opacity = '0.5';
          thumbsDownBtn.style.background = 'transparent';
        }
      });
      
      thumbsDownBtn.addEventListener('click', () => {
        if (thumbsDownBtn.disabled) return;
        if (currentRating === 'negative') {
          // Deselect
          currentRating = null;
          thumbsDownBtn.style.opacity = '';
          thumbsDownBtn.style.background = '';
        } else {
          // Select thumbs down
          currentRating = 'negative';
          thumbsDownBtn.style.opacity = '1';
          thumbsDownBtn.style.background = 'rgba(244, 67, 54, 0.3)';
          thumbsUpBtn.style.opacity = '0.5';
          thumbsUpBtn.style.background = 'transparent';
        }
      });
      
      // Handle input events
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const feedback = input.value.trim();
          // Allow rating-only feedback (no text)
          if (feedback || currentRating) {
            this.submitFeedback(feedback || '', object, currentRating);
            input.value = '';
            currentRating = null;
            thumbsUpBtn.style.opacity = '1';
            thumbsUpBtn.style.background = 'transparent';
            thumbsDownBtn.style.opacity = '1';
            thumbsDownBtn.style.background = 'transparent';
          }
        } else if (e.key === 'Escape') {
          this.hideFeedbackUI();
        }
        // Note: Ctrl+Z and Ctrl+Y are handled globally in _keys() method
      });
    }
    
    // Handle dropdown menu for group editing (for all objects)
    const dropdownBtn = feedbackDiv.querySelector('.feedback-btn-dropdown');
    const dropdownMenu = feedbackDiv.querySelector('.feedback-dropdown-menu');
    
    if (dropdownBtn && dropdownMenu) {
      // Function to update dropdown menu items
      const updateDropdownMenu = () => {
        const menuItems = [];
        
        // Determine if multiple objects are selected (for Create Group)
        const selectedCount = this.selectedSet?.size || 0;
        const canCreateGroup = selectedCount > 1;
        const canEditGroup = isComposite && !this.groupEditMode;
        const canExitGroup = this.groupEditMode;
        const hasClipboard = this._clipboard !== null;
        
        // Copy/Paste/Duplicate options
        menuItems.push({
          label: 'Copy',
          enabled: true,
          action: () => {
            this.copyObject();
            dropdownMenu.style.display = 'none';
          }
        });
        
        menuItems.push({
          label: 'Paste',
          enabled: hasClipboard,
          action: () => {
            if (hasClipboard) {
              this.pasteObject();
              dropdownMenu.style.display = 'none';
            }
          }
        });
        
        menuItems.push({
          label: 'Duplicate',
          enabled: true,
          action: () => {
            this.duplicateObject();
            dropdownMenu.style.display = 'none';
          }
        });
        
        // Group management options
        menuItems.push({
          label: 'Create Group',
          enabled: canCreateGroup,
          action: () => {
            if (canCreateGroup) {
              // Group the selected objects
              this.createGroup();
              dropdownMenu.style.display = 'none';
            }
          }
        });
        
        menuItems.push({
          label: 'Edit Group',
          enabled: canEditGroup,
          action: () => {
            if (canEditGroup) {
              this.enterGroupEdit(object);
              dropdownMenu.style.display = 'none';
            }
          }
        });
        
        menuItems.push({
          label: 'Exit Group',
          enabled: canExitGroup,
          action: () => {
            if (canExitGroup) {
              this.exitGroupEdit();
              dropdownMenu.style.display = 'none';
            }
          }
        });
        
        // Add menu items to dropdown
        dropdownMenu.innerHTML = menuItems.map((item, idx) => {
          const disabledClass = item.enabled ? '' : ' disabled';
          return `<button class="feedback-dropdown-item${disabledClass}" data-index="${idx}" ${item.enabled ? '' : 'disabled'}>${item.label}</button>`;
        }).join('');
        
        // Handle menu item clicks
        dropdownMenu.querySelectorAll('.feedback-dropdown-item').forEach((btn, idx) => {
          btn.addEventListener('click', () => {
            if (menuItems[idx]?.enabled) {
              menuItems[idx]?.action();
            }
          });
        });
      };
      
      // Initialize dropdown menu
      updateDropdownMenu();
      
      // Toggle dropdown visibility
      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateDropdownMenu(); // Update menu items before showing (in case state changed)
        const isVisible = dropdownMenu.style.display === 'block';
        dropdownMenu.style.display = isVisible ? 'none' : 'block';
        dropdownBtn.classList.toggle('open');
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        dropdownMenu.style.display = 'none';
        dropdownBtn.classList.remove('open');
      });
    }
    
    // Initial button state
    updateButtonStates();
    
    // Create CSS3D object
    const css3DObject = new CSS3DObject(feedbackDiv);
    
    // Position above the object
    const box = new THREE.Box3();
    if (object.userData?.composition && object.children.length > 0) {
      // Composite object: calc from children only
      object.children.forEach(child => box.expandByObject(child));
    } else {
      // Simple object: include entire object
      box.setFromObject(object);
    }
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    
    css3DObject.position.copy(center);
    // Initial position - will be refined in _updateFeedbackBillboard with screen-space offset
    css3DObject.position.y = box.max.y;
    // Scale will be adjusted dynamically in _updateFeedbackBillboard for constant visual size
    css3DObject.scale.set(0.012, 0.012, 0.012); // Initial scale (will be updated each frame)
    
    this.css3DScene.add(css3DObject);
    this.feedbackUI = { 
      object: css3DObject, 
      htmlElement: feedbackDiv, 
      targetObject: object,
      objectBox: box.clone(), // Store initial box for screen-space calculations
      updateButtonStates: updateButtonStates // Save reference to update function
    };
    
    // Don't auto-focus input - let user click to activate (same as chatbox)
    } catch (err) {
      console.error('❌ Error creating feedback UI:', err);
    }
  }
  
  // Hide 3D feedback UI
  hideFeedbackUI() {
    if (this.feedbackUI) {
      this.css3DScene.remove(this.feedbackUI.object);
      this.feedbackUI.htmlElement.remove();
      this.feedbackUI = null;
    }
  }
  
  // Update feedback UI to always face camera (billboard) and maintain constant screen size
  _updateFeedbackBillboard() {
    if (!this.feedbackUI) return;
    
    // Make CSS3D object face camera
    this.feedbackUI.object.lookAt(this.camera.position);
    
    // Update position if target object moved
    const obj = this.feedbackUI.targetObject;
    if (obj && obj.parent) {
      const box = new THREE.Box3();
      if (obj.userData?.composition && obj.children.length > 0) {
        // Composite object: calc from children only
        obj.children.forEach(child => box.expandByObject(child));
      } else {
        // Simple object: include entire object
        box.setFromObject(obj);
      }
      const center = new THREE.Vector3();
      box.getCenter(center);
      
      // Position feedback box above object in world space
      this.feedbackUI.object.position.copy(center);
      this.feedbackUI.object.position.y = box.max.y;
      
      // Now add screen-space offset to keep it away from object on screen
      // Convert top of object to screen coordinates
      const topOfObject = new THREE.Vector3(center.x, box.max.y, center.z);
      const screenPos = new THREE.Vector3();
      screenPos.copy(topOfObject).project(this.camera);
      
      // topOfObject is at max.y, feedback should be below it by ~50 pixels on screen
      // Work backward from screen space to world space
      const pixelOffset = 50; // 50 pixels gap on screen
      const screenGap = (pixelOffset * 2) / this.renderer.domElement.clientHeight; // convert to NDC
      
      // Calculate how much world distance corresponds to this screen gap
      // Use a vector slightly below the top of object
      const offsetTarget = topOfObject.clone();
      offsetTarget.project(this.camera);
      offsetTarget.y -= screenGap; // Move down in screen space
      offsetTarget.unproject(this.camera); // Convert back to world space
      
      // Position feedback above the offset target
      const worldGap = topOfObject.distanceTo(offsetTarget);
      this.feedbackUI.object.position.y = box.max.y + worldGap;
    }
    
    // Scale proportional to distance to maintain constant screen size
    const distanceToCam = this.feedbackUI.object.position.distanceTo(this.camera.position);
    let dynamicScale;
    
    if (this.camera.isPerspectiveCamera) {
      // For perspective: scale proportional to distance (closer = smaller scale, farther = larger scale)
      dynamicScale = 0.0015 * distanceToCam;
    } else {
      // For orthographic: scale inversely with zoom
      dynamicScale = 0.012 / this.camera.zoom;
    }
    
    this.feedbackUI.object.scale.set(dynamicScale, dynamicScale, dynamicScale);
  }

  // Submit feedback to improve object (works for composite and simple objects)
  async submitFeedback(feedback, targetObject, rating = null) {
    if (!targetObject) {
      console.error('submitFeedback: invalid targetObject');
      return;
    }
    
    // Allow rating-only feedback or text feedback
    if (!feedback.trim() && !rating) {
      console.log('submitFeedback: no feedback or rating provided');
      return;
    }

    try {
      if (!targetObject.userData.composition) {
        const pos = targetObject.position;

        let geometryType = 'cube';
        let params = { x: pos.x, y: pos.y, z: pos.z };
        
        if (targetObject.geometry) {
          const geo = targetObject.geometry;
          
          if (geo.type === 'SphereGeometry') {
            geometryType = 'sphere';
            params.type = 'sphere';
            params.radius = geo.parameters?.radius || 1;
          } else if (geo.type === 'BoxGeometry') {
            geometryType = 'cube';
            params.type = 'cube';
            params.size = geo.parameters?.width || 2;
          } else if (geo.type === 'CylinderGeometry') {
            geometryType = 'cylinder';
            params.type = 'cylinder';
            params.diameter = (geo.parameters?.radiusTop || 0.5) * 2;
            params.height = geo.parameters?.height || 1;
          } else if (geo.type === 'ConeGeometry') {
            geometryType = 'cone';
            params.type = 'cone';
            params.radius = geo.parameters?.radius || 1;
            params.height = geo.parameters?.height || 2;
          }
          
          // Get current color from material
          if (targetObject.material && targetObject.material.color) {
            const color = targetObject.material.color.getHex();
            params.color = '#' + color.toString(16).padStart(6, '0');
          }
        }
        
        // Create single-part composition
        targetObject.userData.composition = [params];
        targetObject.userData.compositeName = geometryType;
      }
      
      // Save old composition BEFORE hiding UI
      const oldComposition = targetObject.userData.composition 
        ? JSON.parse(JSON.stringify(targetObject.userData.composition)) 
        : null;
      
      // Hide UI while processing
      this.hideFeedbackUI();
      
      
      // Prepare request based on object type
      let requestBody;
      
      // Now all objects have composition
      requestBody = {
        objectName: targetObject.userData.compositeName || 'object',
        feedback: feedback,
        currentComposition: targetObject.userData.composition,
        rating: rating // 'positive', 'negative', or null
      };
      
      const body = JSON.stringify(requestBody);
      
      // Use relative URL instead of hard-coded localhost
      const apiUrl = '/api/feedback';
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      });
      
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Server error:', errorText);
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      if (!data.ok) {
        console.error('❌ Server returned ok=false:', data.error);
        throw new Error(data.error || 'Server returned ok=false');
      }
      
      if (!data.spec || !data.spec.composition) {
        console.error('❌ Server did not return spec with composition');
        throw new Error('Server returned no spec data');
      }
      
      
      if (data.ok && data.spec) {
        const newComposition = data.spec.composition;

        if (!targetObject.userData.history) {
          targetObject.userData.history = [];
          targetObject.userData.redoStack = [];
        }

        targetObject.userData.history.push({
          type: "composition-change",
          before: oldComposition,
          after: newComposition
        });

        targetObject.userData.redoStack = [];
        targetObject.userData.composition = newComposition;

        this._rebuildCompositeVisuals(targetObject);
        this.showFeedbackUI(targetObject);

        if (this.feedbackUI && this.feedbackUI.updateButtonStates) {
          this.feedbackUI.updateButtonStates();
        }
      }

    } catch (err) {
      console.error('Error submitting feedback:', err);
      alert('Error improving object. Try again.');
      if (targetObject) this.showFeedbackUI(targetObject);
    }
  }

  executeCommands(commands = []) {
    for (const cmd of commands) {
      switch (cmd.action) {
        case 'addWall':
          this.addWall(cmd.params);
          break;
        case 'addCylinder':
          this.addCylinder(cmd.params);
          break;
        case 'addCube':
          this.addCube(cmd.params);
          break;
        case 'addTriangle':
          this.addTriangle(cmd.params);
          break;
        case 'addSphere':
          this.addSphere(cmd.params);
          break;
        case 'addCone':
          this.addCone(cmd.params);
          break;
        case 'addTorus':
          this.addTorus(cmd.params);
          break;
        case 'addBox':
          this.addBox(cmd.params);
          break;
        case 'addCapsule':
          this.addCapsule(cmd.params);
          break;
        case 'addComposite':
          this.addComposite(cmd.params);
          break;
        case 'addArch':
          this.addArch(cmd.params);
          break;
        case 'addRoof':
          this.addRoof(cmd.params);
          break;
        case 'addStair':
          this.addStair(cmd.params);
          break;
        case 'addDome':
          this.addDome(cmd.params);
          break;
        case 'addColumnWithCapital':
          this.addColumnWithCapital(cmd.params);
          break;
        default:
          break;
      }
    }
  }

  addHuman({ x = 0, z = 0, h = 1.85 } = {}) {
    const geo = new THREE.PlaneGeometry(h * 0.5, h);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);

    mesh.position.set(x, h / 2, z);
    mesh.userData.billboard = true;
    mesh.userData.selectable = true;
    mesh.userData.isHuman = true;
    mesh.userData.src = HUMAN_PNG_URL;

    this.scene.add(mesh);
    this._billboards.push(mesh);
    this._addSel(mesh);

    new THREE.TextureLoader().load(
      HUMAN_PNG_URL,
      (tex) => {
        if (tex.colorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        const w = tex.image?.width || 512;
        const hh = tex.image?.height || 1024;
        const aspect = w / hh;
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(h * aspect, h);
        mesh.material.map = tex;
        mesh.material.opacity = 1;
        mesh.material.needsUpdate = true;
      },
      undefined,
      (err) => console.error("Falhou carregar silhueta:", HUMAN_PNG_URL, err)
    );

    return mesh;
  }

  _updateBillboards() {
    for (const m of this._billboards) {
      if (!m?.parent || !m.userData?.billboard) continue;
      const dir = new THREE.Vector3().subVectors(this.camera.position, m.position);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) continue;
      m.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    }
  }

  // Recolor TransformControls gizmo arrows to match our axis color scheme
  _recolorGizmo() {
    const helper = this.transform.getHelper();
    // Match axis colors: X=green, Y=blue (up), Z=red
    const colorMap = { X: 0x34c759, Y: 0x007aff, Z: 0xff3b30 };
    try {
      helper.traverse((child) => {
        if (child.material && colorMap[child.name] !== undefined) {
          child.material = child.material.clone();
          child.material.color.setHex(colorMap[child.name]);
        }
      });
    } catch (_) { /* safety: never crash the engine over gizmo colors */ }
  }

  // Axes helper - infinite appearance with minimal performance cost
  // Z-up coordinate system: X=red (right), Y=green (forward), Z=blue (up)
  _addAxes(len = 50000) {
    const axes = new THREE.Group(), DASH = 0.35, GAP = 0.25;
    const mk = (v, c) => {
      const g = new THREE.Group();
      const p = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), v.clone().multiplyScalar(len)]),
        new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95 })
      );
      const n = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), v.clone().multiplyScalar(-len)]),
        new THREE.LineDashedMaterial({ color: c, transparent: true, opacity: 0.55, dashSize: DASH, gapSize: GAP })
      );
      n.computeLineDistances();
      p.frustumCulled = n.frustumCulled = false;
      g.add(p, n);
      return g;
    };
    // Z-up: X=green, Y=blue (up), Z=red (forward/depth)
    axes.add(
      mk(new THREE.Vector3(1, 0, 0), 0x34c759),  // X = green
      mk(new THREE.Vector3(0, 0, 1), 0xff3b30),  // Z = red (forward, swapped with green)
      mk(new THREE.Vector3(0, 1, 0), 0x007aff)   // Y = blue (up)
    );
    this.scene.add(axes);
  }

  exportGLB() {
    new GLTFExporter().parse(
      this.scene,
      (res) => {
        const url = URL.createObjectURL(new Blob([res], { type: "model/gltf-binary" }));
        Object.assign(document.createElement("a"), { href: url, download: "ai-arch.glb" }).click();
        URL.revokeObjectURL(url);
      },
      { binary: true }
    );
  }

  importGLB(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const loader = new GLTFLoader();
      loader.parse(e.target.result, '', (gltf) => {
        const model = gltf.scene;
        model.position.set(0, 0, 0);
        model.userData.selectable = true;
        
        // recursively mark all children as selectable for raycasting
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.userData.selectable = true;
          }
        });
        
        this.scene.add(model);
        // add all meshes to selectables
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            this._addSel(child);
          }
        });
        this._push({ type: "add", object: model });
      }, (error) => {
        console.error('❌ Failed to load model:', error);
      });
    };
    reader.readAsArrayBuffer(file);
  }
}
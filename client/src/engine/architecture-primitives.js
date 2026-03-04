import * as THREE from 'three';

/**
 * Architecture-specific primitives with semantic meaning
 * These primitives understand architectural concepts like doors, windows, walls
 * Using visual representation (frames + transparent planes) instead of CSG boolean operations
 */

/**
 * Create a wall with optional doors and windows
 * @param {Object} params
 * @param {number} params.width - Wall width (X axis)
 * @param {number} params.height - Wall height (Y axis)
 * @param {number} params.thickness - Wall depth (Z axis)
 * @param {Array} params.doors - Array of {position: 0-1, width, height}
 * @param {Array} params.windows - Array of {position: 0-1, width, height, sillHeight}
 * @returns {THREE.Group}
 */
export function createWall(params = {}) {
  const {
    width = 4,
    height = 3,
    thickness = 0.3,
    doors = [],
    windows = [],
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'Wall';
  group.userData.params = params;

  // Base wall geometry
  const wallGeo = new THREE.BoxGeometry(width, height, thickness);
  const wallMat = material || new THREE.MeshStandardMaterial({ 
    color: 0x9aa3b2,
    side: THREE.DoubleSide
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(0, height / 2, 0);
  
  group.add(wall);

  // Add doors as separate visible geometry (visual cutouts)
  for (const door of doors) {
    const doorX = (door.position - 0.5) * width;
    const doorWidth = door.width || 1;
    const doorHeight = door.height || 2.1;
    
    // Create door frame outline (visual)
    const frameGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(doorWidth, doorHeight, thickness * 1.5)
    );
    const frameLine = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0x000000 }));
    frameLine.position.set(doorX, doorHeight / 2 + 0.3, 0);
    group.add(frameLine);
    
    // Create semi-transparent door opening
    const openingGeo = new THREE.PlaneGeometry(doorWidth * 0.95, doorHeight * 0.95);
    const openingMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });
    const opening = new THREE.Mesh(openingGeo, openingMat);
    opening.position.set(doorX, doorHeight / 2 + 0.3, thickness / 2 + 0.01);
    group.add(opening);
  }

  // Add windows as separate visible geometry
  for (const window of windows) {
    const windowX = (window.position - 0.5) * width;
    const windowWidth = window.width || 1.2;
    const windowHeight = window.height || 1;
    const windowSill = window.sillHeight || 1.2;
    
    // Window frame outline
    const frameGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(windowWidth, windowHeight, thickness * 1.5)
    );
    const frameLine = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0x333333 }));
    frameLine.position.set(windowX, windowSill + windowHeight / 2, 0);
    group.add(frameLine);
    
    // Glass pane (semi-transparent)
    const glassGeo = new THREE.PlaneGeometry(windowWidth * 0.9, windowHeight * 0.9);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x87ceeb,
      transparent: true,
      opacity: 0.25,
      metalness: 0.8,
      roughness: 0.1,
      side: THREE.DoubleSide
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(windowX, windowSill + windowHeight / 2, thickness / 2 + 0.01);
    group.add(glass);
  }

  return group;
}

/**
 * Create a room (4 walls with doors/windows)
 * @param {Object} params
 * @returns {THREE.Group}
 */
export function createRoom(params = {}) {
  const {
    width = 5,
    depth = 4,
    height = 3,
    thickness = 0.3,
    doors = {}, // { north, east, south, west }
    windows = {} // { north, east, south, west }
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'Room';
  group.userData.params = params;

  // North wall
  const northWall = createWall({
    width,
    height,
    thickness,
    doors: doors.north || [],
    windows: windows.north || []
  });
  northWall.position.set(0, 0, -depth / 2);
  group.add(northWall);

  // South wall
  const southWall = createWall({
    width,
    height,
    thickness,
    doors: doors.south || [],
    windows: windows.south || []
  });
  southWall.position.set(0, 0, depth / 2);
  southWall.rotation.y = Math.PI;
  group.add(southWall);

  // East wall
  const eastWall = createWall({
    width: depth,
    height,
    thickness,
    doors: doors.east || [],
    windows: windows.east || []
  });
  eastWall.position.set(width / 2, 0, 0);
  eastWall.rotation.y = Math.PI / 2;
  group.add(eastWall);

  // West wall
  const westWall = createWall({
    width: depth,
    height,
    thickness,
    doors: doors.west || [],
    windows: windows.west || []
  });
  westWall.position.set(-width / 2, 0, 0);
  westWall.rotation.y = -Math.PI / 2;
  group.add(westWall);

  // Floor
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // Ceiling
  const ceilingGeo = new THREE.PlaneGeometry(width, depth);
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  group.add(ceiling);

  return group;
}

/**
 * Create a door frame with door panel
 * @param {Object} params
 * @returns {THREE.Group}
 */
export function createDoor(params = {}) {
  const {
    width = 1,
    height = 2.1,
    thickness = 0.05,
    frameThickness = 0.1,
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'Door';
  group.userData.params = params;

  const frameMat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });

  // Frame
  const frameGeo = new THREE.BoxGeometry(width, height, frameThickness);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  group.add(frame);

  // Panel (door leaf)
  const panelGeo = new THREE.BoxGeometry(width - frameThickness * 2, height - frameThickness * 2, thickness);
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.position.z = frameThickness / 2 + thickness / 2;
  group.add(panel);

  return group;
}

/**
 * Create a window frame with glass
 * @param {Object} params
 * @returns {THREE.Group}
 */
export function createWindow(params = {}) {
  const {
    width = 1.2,
    height = 1,
    depth = 0.2,
    frameThickness = 0.08,
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'Window';
  group.userData.params = params;

  const frameMat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x87ceeb,
    transparent: true,
    opacity: 0.3,
    metalness: 0.8,
    roughness: 0.1
  });

  // Frame
  const frameGeo = new THREE.BoxGeometry(width, height, frameThickness);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  group.add(frame);

  // Glass pane
  const glassGeo = new THREE.PlaneGeometry(width - frameThickness, height - frameThickness);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.z = frameThickness / 2 + 0.01;
  group.add(glass);

  return group;
}

/**
 * Create a column/pillar
 * @param {Object} params
 * @returns {THREE.Mesh}
 */
export function createColumn(params = {}) {
  const {
    diameter = 0.4,
    height = 3,
    segments = 8,
    material = null
  } = params;

  const geo = new THREE.CylinderGeometry(diameter / 2, diameter / 2, height, segments);
  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const mesh = new THREE.Mesh(geo, mat);
  
  mesh.userData.type = 'Column';
  mesh.userData.params = params;
  
  return mesh;
}

/**
 * Create a beam/lintel
 * @param {Object} params
 * @returns {THREE.Mesh}
 */
export function createBeam(params = {}) {
  const {
    length = 5,
    height = 0.3,
    depth = 0.4,
    material = null
  } = params;

  const geo = new THREE.BoxGeometry(length, height, depth);
  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const mesh = new THREE.Mesh(geo, mat);
  
  mesh.userData.type = 'Beam';
  mesh.userData.params = params;
  
  return mesh;
}

/**
 * Create an arch (semicircular or pointed opening)
 * @param {Object} params
 * @param {number} params.radius - Arch radius/span
 * @param {number} params.thickness - Arch depth/thickness
 * @param {number} params.archType - 'semicircle' | 'pointed' | 'segmental'
 * @param {number} params.segmentCount - Number of segments for curve
 * @returns {THREE.Group}
 */
export function createArch(params = {}) {
  const {
    radius = 1.5,
    thickness = 0.2,
    archType = 'semicircle',
    segmentCount = 16,
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'Arch';
  group.userData.params = params;

  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  
  // Create lathe geometry for arch curve
  const points = [];
  const angle = archType === 'semicircle' ? Math.PI : 
                archType === 'pointed' ? Math.PI * 1.2 : 
                Math.PI * 0.6; // segmental

  for (let i = 0; i <= segmentCount; i++) {
    const t = i / segmentCount;
    const theta = angle * t - (angle / 2);
    const x = Math.cos(theta) * radius;
    const y = Math.sin(theta) * radius;
    points.push(new THREE.Vector2(x, y));
  }

  // Outer arch
  const latheGeo = new THREE.LatheGeometry(points, 8);
  const arch = new THREE.Mesh(latheGeo, mat);
  arch.scale.set(1, 1, thickness / (radius * 0.5));
  arch.rotation.x = Math.PI / 2;
  group.add(arch);

  // Inner void (optional)
  const innerPoints = points.map(p => new THREE.Vector2(p.x * 0.7, p.y * 0.7));
  const innerLathe = new THREE.LatheGeometry(innerPoints, 8);
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, side: THREE.BackSide });
  const innerArch = new THREE.Mesh(innerLathe, innerMat);
  innerArch.scale.set(1, 1, thickness / (radius * 0.5));
  innerArch.rotation.x = Math.PI / 2;
  innerArch.position.z = 0.01;
  group.add(innerArch);

  return group;
}

/**
 * Create a pitched roof (triangular gable)
 * @param {Object} params
 * @param {number} params.width - Roof base width
 * @param {number} params.depth - Roof depth
 * @param {number} params.height - Peak height above base
 * @param {number} params.material - Material color
 * @returns {THREE.Group}
 */
export function createPitchedRoof(params = {}) {
  const {
    width = 4,
    depth = 3,
    height = 1.5,
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'PitchedRoof';
  group.userData.params = params;

  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });

  // Two triangular faces (gables)
  const vertices = new Float32Array([
    // Left triangle
    -width / 2, 0, -depth / 2,  // base left
    -width / 2, 0, depth / 2,   // base right
    0, height, 0,               // peak
    // Right triangle
    width / 2, 0, -depth / 2,   // base left
    width / 2, 0, depth / 2,    // base right
    0, height, 0                // peak
  ]);

  const indices = new Uint16Array([
    0, 1, 2,  // left face
    3, 5, 4   // right face
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const roof = new THREE.Mesh(geo, mat);
  group.add(roof);

  // Base edge (optional trim)
  const trimGeo = new THREE.BoxGeometry(width, 0.1, depth);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const trim = new THREE.Mesh(trimGeo, trimMat);
  trim.position.y = -0.05;
  group.add(trim);

  return group;
}

/**
 * Create a dome (hemispherical structure)
 * @param {Object} params
 * @param {number} params.radius - Dome radius
 * @param {number} params.widthSegments - Horizontal segments
 * @param {number} params.heightSegments - Vertical segments
 * @returns {THREE.Mesh}
 */
export function createDome(params = {}) {
  const {
    radius = 2,
    widthSegments = 32,
    heightSegments = 16,
    material = null
  } = params;

  const geo = new THREE.SphereGeometry(radius, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const dome = new THREE.Mesh(geo, mat);
  
  dome.userData.type = 'Dome';
  dome.userData.params = params;
  
  return dome;
}

/**
 * Create stairs (zigzag staircase)
 * @param {Object} params
 * @param {number} params.width - Stair width
 * @param {number} params.stepCount - Number of steps
 * @param {number} params.stepHeight - Height per step
 * @param {number} params.stepDepth - Depth per step
 * @returns {THREE.Group}
 */
export function createStairs(params = {}) {
  const {
    width = 1.2,
    stepCount = 6,
    stepHeight = 0.3,
    stepDepth = 0.4,
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'Stairs';
  group.userData.params = params;

  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });

  // Create each step
  for (let i = 0; i < stepCount; i++) {
    const stepGeo = new THREE.BoxGeometry(width, stepHeight, stepDepth);
    const step = new THREE.Mesh(stepGeo, mat);
    
    step.position.y = (i + 0.5) * stepHeight;
    step.position.z = i * stepDepth;
    
    group.add(step);
  }

  // Optional: left railing
  const railGeo = new THREE.BoxGeometry(0.05, stepCount * stepHeight, stepCount * stepDepth);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const leftRail = new THREE.Mesh(railGeo, railMat);
  leftRail.position.x = -width / 2 - 0.05;
  leftRail.position.y = (stepCount * stepHeight) / 2;
  leftRail.position.z = (stepCount * stepDepth) / 2;
  group.add(leftRail);

  // Optional: right railing
  const rightRail = new THREE.Mesh(railGeo, railMat);
  rightRail.position.x = width / 2 + 0.05;
  rightRail.position.y = (stepCount * stepHeight) / 2;
  rightRail.position.z = (stepCount * stepDepth) / 2;
  group.add(rightRail);

  return group;
}

/**
 * Create a column with decorative capital (top)
 * @param {Object} params
 * @param {number} params.diameter - Column diameter
 * @param {number} params.height - Column height
 * @param {number} params.baseType - 'plinth' | 'attic' (base style)
 * @param {number} params.capitalType - 'doric' | 'ionic' | 'corinthian'
 * @returns {THREE.Group}
 */
export function createColumnWithCapital(params = {}) {
  const {
    diameter = 0.4,
    height = 3,
    baseType = 'plinth',
    capitalType = 'ionic',
    material = null
  } = params;

  const group = new THREE.Group();
  group.userData.type = 'ColumnWithCapital';
  group.userData.params = params;

  const mat = material || new THREE.MeshStandardMaterial({ color: 0x9aa3b2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

  // Base plinth
  const baseDim = diameter * 1.3;
  const basGeo = new THREE.BoxGeometry(baseDim, 0.2, baseDim);
  const base = new THREE.Mesh(basGeo, accentMat);
  base.position.y = 0.1;
  group.add(base);

  // Column shaft (fluted)
  const shaftGeo = new THREE.CylinderGeometry(diameter / 2, diameter / 2, height - 0.4, 12);
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.y = height / 2;
  group.add(shaft);

  // Capital (decorative top) - simplified
  const capHeight = 0.3;
  const capBase = diameter * 1.15;
  
  if (capitalType === 'doric') {
    // Simple abacus (square top)
    const abacusGeo = new THREE.BoxGeometry(capBase, capHeight * 0.4, capBase);
    const abacus = new THREE.Mesh(abacusGeo, accentMat);
    abacus.position.y = height - 0.1;
    group.add(abacus);
  } else if (capitalType === 'ionic' || capitalType === 'corinthian') {
    // Curved capital using cone + cylinder
    const echGeo = new THREE.ConeGeometry(capBase / 2, capHeight * 0.6, 8);
    const echinus = new THREE.Mesh(echGeo, accentMat);
    echinus.position.y = height - 0.15;
    group.add(echinus);
    
    // Abacus
    const abacusGeo = new THREE.BoxGeometry(capBase, capHeight * 0.4, capBase);
    const abacus = new THREE.Mesh(abacusGeo, accentMat);
    abacus.position.y = height - 0.02;
    group.add(abacus);
  }

  return group;
}

/**
 * Create Bezier Surface (parametric curved surface)
 * @param {Object} params
 * @param {Array<Array<Array<number>>>} params.controlGrid - 2D grid of [x,y,z] control points
 * @param {number} params.segments - Subdivisions for rendering (default 20)
 * @param {THREE.Material} params.material - Optional material
 * @returns {THREE.Mesh}
 */
export function createBezierSurface(params = {}) {
  const {
    controlGrid = [
      [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      [[0, 1, 1], [1, 1, 2], [2, 1, 1]],
      [[0, 2, 0], [1, 2, 0], [2, 2, 0]]
    ],
    segments = 20,
    material = null
  } = params;

  // Compute binomial coefficient
  const binomial = (n, k) => {
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    let result = 1;
    for (let j = 1; j <= Math.min(k, n - k); j++) {
      result = result * (n - j + 1) / j;
    }
    return result;
  };

  // Bernstein basis polynomial
  const bernstein = (n, i, t) => {
    return binomial(n, i) * Math.pow(1 - t, n - i) * Math.pow(t, i);
  };

  // Evaluate surface at (u, v) using Bezier basis
  const evaluateSurface = (u, v) => {
    const n = controlGrid.length - 1;
    const m = controlGrid[0].length - 1;
    const point = [0, 0, 0];

    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        const basisValue = bernstein(n, i, u) * bernstein(m, j, v);
        point[0] += basisValue * controlGrid[i][j][0];
        point[1] += basisValue * controlGrid[i][j][1];
        point[2] += basisValue * controlGrid[i][j][2];
      }
    }
    return point;
  };

  // Generate surface geometry
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j <= segments; j++) {
      const u = i / segments;
      const v = j / segments;
      const point = evaluateSurface(u, v);
      vertices.push(point[0], point[1], point[2]);
    }
  }

  // Create face indices (two triangles per quad)
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (segments + 1) + j;
      const d = c + 1;

      // Triangle 1: a, c, b
      indices.push(a, c, b);
      // Triangle 2: b, c, d
      indices.push(b, c, d);
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    material || new THREE.MeshStandardMaterial({ color: 0x888888, wireframe: false })
  );

  mesh.userData.type = 'BezierSurface';
  mesh.userData.params = params;

  return mesh;
}

/**
 * Parse natural language description to architectural parameters
 * Uses simple rule-based parsing (can be enhanced with LLM)
 */
export function parseArchitectureDescription(description) {
  const desc = description.toLowerCase();
  const result = {
    type: 'Wall', // default
    params: {}
  };

  // Detect room vs wall
  if (desc.includes('room') || desc.includes('sala') || desc.includes('quarto')) {
    result.type = 'Room';
  }

  // Parse dimensions
  const widthMatch = desc.match(/(\d+\.?\d*)\s*(?:m|metros|wide|width)/) || 
                     desc.match(/wide\s*(\d+\.?\d*)/);
  if (widthMatch) result.params.width = parseFloat(widthMatch[1]);

  const heightMatch = desc.match(/(\d+\.?\d*)\s*(?:m|metros|tall|high|height)/) ||
                      desc.match(/tall\s*(\d+\.?\d*)/);
  if (heightMatch) result.params.height = parseFloat(heightMatch[1]);

  // Parse doors
  if (desc.includes('door') || desc.includes('porta') || desc.includes('porta')) {
    const doorCount = (desc.match(/(\d+)\s*(?:door|porta)/gi) || ['0'])[0].match(/\d+/)[0] || 1;
    result.params.doors = [];
    for (let i = 0; i < doorCount; i++) {
      result.params.doors.push({
        position: (i + 0.5) / doorCount,
        width: 1,
        height: 2.1
      });
    }
  }

  // Parse windows
  if (desc.includes('window') || desc.includes('janela')) {
    const windowCount = (desc.match(/(\d+)\s*(?:window|janela)/gi) || ['0'])[0].match(/\d+/)[0] || 1;
    result.params.windows = [];
    for (let i = 0; i < windowCount; i++) {
      result.params.windows.push({
        position: (i + 0.5) / windowCount,
        width: 1.2,
        height: 1,
        sillHeight: 1.2
      });
    }
  }

  return result;
}

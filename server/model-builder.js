// model-builder.js
// convert a parsed `spec` from the LLM into a minimal set of "commands" that
// the front end's Engine can understand. In a real app you could also return
// actual mesh data, but we're keeping this simple.

// helper to convert a single spec to commands
function specToCommands(spec) {
  const commands = [];
  
  // Handle composite objects (learned from AI)
  if (spec.composition) {
    commands.push({ 
      action: 'addComposite', 
      params: {
        composition: spec.composition,
        x: spec.x || 0,
        z: spec.z || 0,
        name: spec.type
      }
    });
    return commands;
  }
  
  // Handle simple primitives
  switch (spec.type) {
    case 'wall':
      commands.push({ action: 'addWall', params: spec });
      break;
    case 'cylinder':
      commands.push({ action: 'addCylinder', params: spec });
      break;
    case 'cube':
      commands.push({ action: 'addCube', params: spec });
      break;
    case 'triangle':
      commands.push({ action: 'addTriangle', params: spec });
      break;
    case 'sphere':
      commands.push({ action: 'addSphere', params: spec });
      break;
    case 'cone':
      commands.push({ action: 'addCone', params: spec });
      break;
    default:
      commands.push({ action: 'unknown', params: spec });
  }
  return commands;
}

export function buildFromSpec(specOrArray) {
  const commands = [];
  if (Array.isArray(specOrArray)) {
    for (const s of specOrArray) {
      commands.push(...specToCommands(s));
    }
  } else {
    commands.push(...specToCommands(specOrArray));
  }
  return { commands };
}

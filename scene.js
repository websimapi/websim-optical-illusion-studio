import * as THREE from "three";
import nipplejs from "nipplejs";

/* -- SHADERS -- */
const vsSource = `
varying vec2 v_uv;
void main() {
    v_uv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fsSource = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_time;
uniform float u_drip_intensity;
varying vec2 v_uv;

// Simple pseudo-random noise
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    f = f*f*(3.0-2.0*f);
    float n = p.x + p.y*57.0;
    return mix(mix( hash(n+0.0), hash(n+1.0),f.x),
               mix( hash(n+57.0), hash(n+58.0),f.x),f.y);
}

void main() {
    vec2 uv = v_uv;
    vec2 center_uv = uv - 0.5;

    // Only apply effect if intensity is > 0
    if (u_drip_intensity > 0.0) {
        float drip_strength = smoothstep(0.0, 0.4, center_uv.y + 0.5);
        float drip_noise = noise(vec2(uv.x * 12.0, u_time * 0.1));
        float drip_offset = pow(drip_noise, 2.0) * u_drip_intensity * drip_strength * 0.3;
        
        float wave_offset = sin(uv.x * 25.0 + u_time * 1.5) * 0.015 * u_drip_intensity * drip_strength;
        
        uv.y -= drip_offset + wave_offset;
    }
    
    vec4 color = texture2D(u_texture, uv);

    // Fade edges to make it look more circular and blend better
    float edge_fade = 1.0 - smoothstep(0.45, 0.5, length(center_uv));
    
    if (edge_fade < 0.01) {
      discard;
    }

    gl_FragColor = vec4(color.rgb, color.a * edge_fade);
}
`;


/* -- DOM & CORE -- */
const canvas = document.getElementById("scene");
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0c);
scene.fog = new THREE.Fog(scene.background, 20, 50);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 1.6, 10);

/* -- ASSET MANAGEMENT -- */
const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);

loadingManager.onLoad = () => {
    setTimeout(() => {
        loadingOverlay.classList.add('hidden');
    }, 500);
};

function updateLoadingText(text) {
    loadingText.textContent = text;
}

/* -- MOVEMENT CONTROLS -- */
let yaw = -Math.PI / 2, pitch = 0;
const speed = 4.0;
const keys = {};
document.addEventListener("keydown", e => keys[e.code] = true);
document.addEventListener("keyup", e => keys[e.code] = false);

canvas.addEventListener("click", () => canvas.requestPointerLock());
document.addEventListener("mousemove", e => {
  if (document.pointerLockElement === canvas) {
    const sensitivity = 0.0025;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
    pitch = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47, pitch));
  }
});

const joy = nipplejs.create({
  zone: document.body, mode: 'static', position: { left: '80px', bottom: '80px' },
  color: 'white', size: 90
});
let joyVec = { x: 0, y: 0 };
joy.on('move', (_, data) => { joyVec = data.vector || { x:0, y:0 }; });
joy.on('end', () => { joyVec = { x: 0, y: 0 }; });


/* -- SCENE STATE -- */
const ceilingMaterials = [];
let dripIntensity = 0.0;


/* -- SCENE BUILDING -- */
async function buildScene() {
    /* -- LIGHTING -- */
    scene.add(new THREE.AmbientLight(0x404040, 0.3));
    const centerLight = new THREE.PointLight(0xffeebb, 1.5, 60, 1);
    centerLight.position.set(0, 15, 0);
    centerLight.castShadow = true;
    centerLight.shadow.mapSize.width = 1024;
    centerLight.shadow.mapSize.height = 1024;
    scene.add(centerLight);

    /* -- TEXTURES -- */
    updateLoadingText("Generating library textures...");
    const [bookshelfResult, floorResult] = await Promise.all([
        websim.imageGen({ prompt: "A seamless, tileable texture of an old, dusty bookshelf filled with leather-bound books of various colors and gold lettering. Photorealistic, moody lighting.", aspect_ratio: "1:1" }),
        websim.imageGen({ prompt: "A seamless, tileable texture of dark, polished marble floor with subtle white veins. Top-down view, photorealistic, slightly reflective.", aspect_ratio: "1:1" })
    ]);

    updateLoadingText("Loading library textures...");
    const [bookshelfTexture, floorTexture] = await Promise.all([
        textureLoader.loadAsync(bookshelfResult.url),
        textureLoader.loadAsync(floorResult.url)
    ]);
    
    bookshelfTexture.wrapS = bookshelfTexture.wrapT = THREE.RepeatWrapping;
    bookshelfTexture.repeat.set(8, 2);

    floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(12, 12);
    
    /* -- GEOMETRY -- */
    const rotundaRadius = 25;
    const rotundaHeight = 20;

    // Floor
    const floorGeo = new THREE.CircleGeometry(rotundaRadius, 64);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.2, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Bookshelf Walls
    const wallGeo = new THREE.CylinderGeometry(rotundaRadius, rotundaRadius, rotundaHeight, 72, 4, true);
    const wallMat = new THREE.MeshStandardMaterial({ map: bookshelfTexture, roughness: 0.8 });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = rotundaHeight / 2;
    walls.receiveShadow = true;
    scene.add(walls);

    // Dome Ceiling
    const domeGeo = new THREE.SphereGeometry(rotundaRadius, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2.2);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, side: THREE.BackSide });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = rotundaHeight - 0.1;
    scene.add(dome);

    await generateAndPlacePortraits(dome);
}

/* -- CEILING MURAL -- */
async function generateAndPlacePortraits(dome) {
    updateLoadingText("Generating ceiling portraits...");
    const subjects = [
      "A wise old wizard with a long white beard, celestial background", "A valiant knight in shining crimson armor, regal background",
      "A majestic teal and magenta dragon, fiery background", "A beautiful queen with a silver crown, castle background"
    ];

    const portraitImageResults = await Promise.all(
        subjects.map(s => {
            const prompt = `Fantasy portrait in a circular ornate gold frame, ${s}. Photorealistic, dramatic lighting, no text, centered.`;
            return websim.imageGen({ prompt, aspect_ratio: "1:1", transparent: true });
        })
    );
    
    updateLoadingText("Placing portraits on ceiling...");
    
    const portraitTextures = await Promise.all(
        portraitImageResults.map(r => textureLoader.loadAsync(r.url))
    );

    portraitTextures.forEach(tex => {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                u_time: { value: 0.0 },
                u_texture: { value: tex },
                u_drip_intensity: { value: 0.0 }
            },
            vertexShader: vsSource,
            fragmentShader: fsSource,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        ceilingMaterials.push(material);
    });
    
    // Center portrait
    const centerGeo = new THREE.CircleGeometry(5, 64);
    const centerPortrait = new THREE.Mesh(centerGeo, ceilingMaterials[0]);
    centerPortrait.position.set(0, dome.position.y - 0.1, 0);
    centerPortrait.rotation.x = -Math.PI / 2;
    scene.add(centerPortrait);
    
    // Surrounding portraits
    const ringRadius = 15;
    const numPortraits = 6;
    for (let i = 0; i < numPortraits; i++) {
        const angle = (i / numPortraits) * Math.PI * 2;
        const x = Math.cos(angle) * ringRadius;
        const z = Math.sin(angle) * ringRadius;
        
        const y = dome.position.y - Math.sqrt(dome.geometry.parameters.radius**2 - ringRadius**2) + 0.2;

        const geo = new THREE.CircleGeometry(4, 64);
        const mat = ceilingMaterials[(i + 1) % ceilingMaterials.length];
        const portrait = new THREE.Mesh(geo, mat);
        
        portrait.position.set(x, y, z);
        
        // Orient portrait to face center and tilt with ceiling
        portrait.lookAt(new THREE.Vector3(x, dome.position.y + 10, z));
        
        scene.add(portrait);
    }
}

/* -- RENDER LOOP -- */
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Trigger drip effect when looking up
  const lookUpThreshold = -1.0; // Radians
  if (pitch < lookUpThreshold) {
      dripIntensity = Math.min(1.0, dripIntensity + dt * 0.4);
  } else {
      dripIntensity = Math.max(0.0, dripIntensity - dt * 0.5);
  }

  // Update ceiling shader uniforms
  ceilingMaterials.forEach(mat => {
      mat.uniforms.u_time.value = now * 0.001;
      mat.uniforms.u_drip_intensity.value = dripIntensity;
  });

  // Movement
  const forward = (keys["KeyW"] ? 1:0) - (keys["KeyS"] ? 1:0) - joyVec.y;
  const strafe = (keys["KeyD"] ? 1:0) - (keys["KeyA"] ? 1:0) + joyVec.x;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const dirX = strafe * cosY - forward * sinY;
  const dirZ = strafe * -sinY - forward * cosY;
  camera.position.x += dirX * speed * dt;
  camera.position.z += dirZ * speed * dt;

  // Collision with walls
  const r = Math.hypot(camera.position.x, camera.position.z);
  const maxR = 25 - 1.0;
  if (r > maxR) {
    camera.position.x *= maxR / r;
    camera.position.z *= maxR / r;
  }
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 1.6, 18);
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  // Resize handling
  const w = window.innerWidth, h = window.innerHeight;
  if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
}

/* -- INITIALIZATION -- */
buildScene().then(() => {
    console.log("Scene built. Explore with WASD + Mouse (click to lock).");
    requestAnimationFrame(animate);
}).catch(err => {
    console.error("Failed to build scene:", err);
    updateLoadingText("Error: Could not build the library.");
});
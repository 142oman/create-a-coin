/* Hyperspace warp field, for the loader.

   Ported to plain JavaScript from the "hyperspace" variant of ThreeUI Community's warp field
   (src/shaders/warp-field/warpFieldRenderer.ts, https://github.com/MengTo/threeui).
   Copyright (c) 2026 Meng To. MIT License: see vendor/LICENSE-threeui.txt.
   Needs Three.js r128 (vendor/three.r128.min.js, MIT, see vendor/LICENSE-three.txt).

   createHyperspace(canvas) -> { resize(width, height), render(), dispose() }
   Changes from the original: TypeScript and React removed, only the hyperspace variant kept, the
   options (speed, opacities, fov) fixed at the component's defaults.
*/
(function () {
  "use strict";

  const RECYCLE_Z = 200;      // every layer streams toward the camera on +z and wraps back once it passes it
  const RESET_Z = -1800;
  const SPEED = 15 * 2.4;     // component default speed, times the hyperspace speed scale
  const STREAK_OPACITY = 0.6, TILE_OPACITY = 0.9, FOV = 75;
  const BACKGROUND = 0x01020a;
  const STREAKS = { count: 1200, radiusMin: 6, radiusSpread: 760, lengthMin: 170, lengthSpread: 420,
    palette: [0xffffff, 0xdbeafe, 0x93c5fd, 0x60a5fa, 0xc7d2fe], opacityScale: 1.45 };

  function createStreakLayer(THREE, group, settings, opacity) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(settings.count * 6);
    const colors = new Float32Array(settings.count * 6);
    const palette = settings.palette.map((hex) => new THREE.Color(hex));
    for (let i = 0; i < settings.count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * settings.radiusSpread + settings.radiusMin;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      const z = (Math.random() - 0.5) * 2000;
      const length = Math.random() * settings.lengthSpread + settings.lengthMin;
      positions[i * 6] = x; positions[i * 6 + 1] = y; positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x; positions[i * 6 + 4] = y; positions[i * 6 + 5] = z + length;
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 6] = c.r; colors[i * 6 + 1] = c.g; colors[i * 6 + 2] = c.b;
      colors[i * 6 + 3] = c.r; colors[i * 6 + 4] = c.g; colors[i * 6 + 5] = c.b;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: opacity * settings.opacityScale, blending: THREE.AdditiveBlending });
    group.add(new THREE.LineSegments(geometry, material));
    const attribute = geometry.attributes.position;
    return {
      update(step) {
        for (let i = 0; i < settings.count; i += 1) {
          positions[i * 6 + 2] += step;
          positions[i * 6 + 5] += step;
          if (positions[i * 6 + 2] > RECYCLE_Z) {
            const length = positions[i * 6 + 5] - positions[i * 6 + 2];
            positions[i * 6 + 2] = RESET_Z;
            positions[i * 6 + 5] = RESET_Z + length;
          }
        }
        attribute.needsUpdate = true;
      },
      dispose() { geometry.dispose(); material.dispose(); },
    };
  }

  function createTunnelTexture(THREE) {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#000000";
      context.fillRect(0, 0, size, size);
      for (let i = 0; i < 240; i += 1) {
        const x = Math.random() * size;
        const width = Math.random() * 3 + 0.6;
        const height = Math.random() * 320 + 90;
        const top = Math.random() * size;
        const alpha = (Math.random() * 0.45 + 0.08).toFixed(3);
        for (const offset of [-size, 0, size]) {   // drawn above and below the seam so the scrolling wrap is invisible
          const gradient = context.createLinearGradient(0, top + offset, 0, top + offset + height);
          gradient.addColorStop(0, "rgba(191,219,254,0)");
          gradient.addColorStop(0.5, "rgba(224,238,255," + alpha + ")");
          gradient.addColorStop(1, "rgba(147,197,253,0)");
          context.fillStyle = gradient;
          context.fillRect(x, top + offset, width, height);
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 2);
    return texture;
  }

  function createGlowTexture(THREE) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.18, "rgba(219,234,254,0.55)");
      gradient.addColorStop(0.45, "rgba(96,165,250,0.16)");
      gradient.addColorStop(1, "rgba(2,6,23,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
    return new THREE.CanvasTexture(canvas);
  }

  function createHyperspaceLayer(THREE, group, opacity) {
    const tunnelTexture = createTunnelTexture(THREE);
    const tunnelGeometry = new THREE.CylinderGeometry(900, 240, 3000, 64, 1, true);
    tunnelGeometry.rotateX(Math.PI / 2);
    const tunnelMaterial = new THREE.MeshBasicMaterial({ map: tunnelTexture, side: THREE.BackSide, transparent: true, opacity: opacity * 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    const tunnel = new THREE.Mesh(tunnelGeometry, tunnelMaterial);
    tunnel.position.z = -1400;
    group.add(tunnel);

    const glowTexture = createGlowTexture(THREE);
    const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.z = -900;
    glow.scale.set(760, 760, 1);
    group.add(glow);
    return {
      update(step, time) {
        tunnelTexture.offset.y -= step * 0.0016;   // the walls run with the streaks, with a slow roll
        tunnel.rotation.z += 0.0016;
        const pulse = 1 + Math.sin(time * 1.6) * 0.06;   // the jump core breathes
        glow.scale.set(760 * pulse, 760 * pulse, 1);
      },
      dispose() {
        tunnelGeometry.dispose(); tunnelMaterial.dispose(); tunnelTexture.dispose();
        glowMaterial.dispose(); glowTexture.dispose();
      },
    };
  }

  window.createHyperspace = function (canvas) {
    const THREE = window.THREE;
    if (!THREE) throw new Error("Three.js is not loaded");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.FogExp2(BACKGROUND, 0.001);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
    camera.position.z = 0;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const group = new THREE.Group();
    scene.add(group);
    const layers = [createStreakLayer(THREE, group, STREAKS, STREAK_OPACITY), createHyperspaceLayer(THREE, group, TILE_OPACITY)];
    let elapsed = 0;
    return {
      resize(width, height) {
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      },
      render() {
        elapsed += 1 / 60;
        layers.forEach((layer) => layer.update(SPEED, elapsed));
        renderer.render(scene, camera);
      },
      dispose() { layers.forEach((layer) => layer.dispose()); renderer.dispose(); },
    };
  };
})();

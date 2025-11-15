// This is a simplified version of OrbitControls, adapted for this project.
// IMPORTANT: Uses global THREE from three.min.js loaded in options.html.
// Do NOT import three here to avoid multiple instances and type mismatches.
const THREE = (typeof window !== 'undefined' && window.THREE) || (typeof globalThis !== 'undefined' && globalThis.THREE);
if (!THREE) {
  throw new Error('OrbitControls: THREE global not found. Ensure three.min.js is loaded before OrbitControls.js');
}

class OrbitControls extends THREE.EventDispatcher {
    constructor(object, domElement) {
        super();

        this.object = object;
        this.domElement = domElement;

        this.enabled = true;
        this.target = new THREE.Vector3();

        this.minDistance = 0;
        this.maxDistance = Infinity;

        this.minZoom = 0;
        this.maxZoom = Infinity;

        this.minPolarAngle = 0;
        this.maxPolarAngle = Math.PI;

        this.minAzimuthAngle = -Infinity;
        this.maxAzimuthAngle = Infinity;

        this.enableDamping = false;
        this.dampingFactor = 0.05;

        this.enableZoom = true;
        this.zoomSpeed = 1.0;

        this.enableRotate = true;
        this.rotateSpeed = 1.0;

        this.enablePan = true;
        this.panSpeed = 1.0;
        this.screenSpacePanning = true;
        this.keyPanSpeed = 7.0;

        this.autoRotate = false;
        this.autoRotateSpeed = 2.0;

        this.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };

        // private variables
        const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_PAN: 4, TOUCH_DOLLY_PAN: 5, TOUCH_DOLLY_ROTATE: 6 };
        let state = STATE.NONE;

        const EPS = 0.000001;

        const spherical = new THREE.Spherical();
        const sphericalDelta = new THREE.Spherical();

        let scale = 1;
        const panOffset = new THREE.Vector3();
        let zoomChanged = false;

        const rotateStart = new THREE.Vector2();
        const rotateEnd = new THREE.Vector2();
        const rotateDelta = new THREE.Vector2();

        const panStart = new THREE.Vector2();
        const panEnd = new THREE.Vector2();
        const panDelta = new THREE.Vector2();

        const dollyStart = new THREE.Vector2();
        const dollyEnd = new THREE.Vector2();
        const dollyDelta = new THREE.Vector2();

        const scope = this;

        this.getPolarAngle = () => spherical.phi;
        this.getAzimuthalAngle = () => spherical.theta;
        this.saveState = () => {
            scope.target0.copy(scope.target);
            scope.position0.copy(scope.object.position);
            scope.zoom0 = scope.object.zoom;
        };

        this.reset = () => {
            scope.target.copy(scope.target0);
            scope.object.position.copy(scope.position0);
            scope.object.zoom = scope.zoom0;
            scope.object.updateProjectionMatrix();
            scope.dispatchEvent({ type: 'change' });
            scope.update();
            state = STATE.NONE;
        };

        this.update = (() => {
            const offset = new THREE.Vector3();
            const quat = new THREE.Quaternion().setFromUnitVectors(object.up, new THREE.Vector3(0, 1, 0));
            const quatInverse = quat.clone().invert();
            const lastPosition = new THREE.Vector3();
            const lastQuaternion = new THREE.Quaternion();

            return function update() {
                const position = scope.object.position;
                offset.copy(position).sub(scope.target);
                offset.applyQuaternion(quat);
                spherical.setFromVector3(offset);

                if (scope.autoRotate && state === STATE.NONE) {
                    rotateLeft(getAutoRotationAngle());
                }

                if (scope.enableDamping) {
                    spherical.theta += sphericalDelta.theta * scope.dampingFactor;
                    spherical.phi += sphericalDelta.phi * scope.dampingFactor;
                } else {
                    spherical.theta += sphericalDelta.theta;
                    spherical.phi += sphericalDelta.phi;
                }

                let min = scope.minAzimuthAngle;
                let max = scope.maxAzimuthAngle;

                if (isFinite(min) && isFinite(max)) {
                    if (min < -Math.PI) min += 2 * Math.PI; else if (min > Math.PI) min -= 2 * Math.PI;
                    if (max < -Math.PI) max += 2 * Math.PI; else if (max > Math.PI) max -= 2 * Math.PI;

                    if (min <= max) {
                        spherical.theta = Math.max(min, Math.min(max, spherical.theta));
                    } else {
                        spherical.theta = (spherical.theta > (min + max) / 2) ?
                            Math.max(min, spherical.theta) :
                            Math.min(max, spherical.theta);
                    }
                }

                spherical.phi = Math.max(scope.minPolarAngle, Math.min(scope.maxPolarAngle, spherical.phi));
                spherical.makeSafe();
                spherical.radius *= scale;
                spherical.radius = Math.max(scope.minDistance, Math.min(scope.maxDistance, spherical.radius));

                scope.target.add(panOffset);
                offset.setFromSpherical(spherical);
                offset.applyQuaternion(quatInverse);
                position.copy(scope.target).add(offset);
                scope.object.lookAt(scope.target);

                if (scope.enableDamping === true) {
                    sphericalDelta.theta *= (1 - scope.dampingFactor);
                    sphericalDelta.phi *= (1 - scope.dampingFactor);
                    panOffset.multiplyScalar(1 - scope.dampingFactor);
                } else {
                    sphericalDelta.set(0, 0, 0);
                    panOffset.set(0, 0, 0);
                }

                scale = 1;
                zoomChanged = false;

                if (zoomChanged || lastPosition.distanceToSquared(scope.object.position) > EPS || 8 * (1 - lastQuaternion.dot(scope.object.quaternion)) > EPS) {
                    scope.dispatchEvent({ type: 'change' });
                    lastPosition.copy(scope.object.position);
                    lastQuaternion.copy(scope.object.quaternion);
                    zoomChanged = false;
                    return true;
                }
                return false;
            };
        })();

        this.dispose = () => {
            scope.domElement.removeEventListener('contextmenu', onContextMenu);
            scope.domElement.removeEventListener('pointerdown', onPointerDown);
            scope.domElement.removeEventListener('wheel', onMouseWheel);
            scope.domElement.removeEventListener('touchstart', onTouchStart);
            scope.domElement.removeEventListener('touchend', onTouchEnd);
            scope.domElement.removeEventListener('touchmove', onTouchMove);
            scope.domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
            scope.domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);
            scope.domElement.removeEventListener('keydown', onKeyDown);
        };

        function getAutoRotationAngle() {
            return 2 * Math.PI / 60 / 60 * scope.autoRotateSpeed;
        }

        function getZoomScale() {
            return Math.pow(0.95, scope.zoomSpeed);
        }

        function rotateLeft(angle) {
            sphericalDelta.theta -= angle;
        }

        function rotateUp(angle) {
            sphericalDelta.phi -= angle;
        }

        const panLeft = (() => {
            const v = new THREE.Vector3();
            return function panLeft(distance, objectMatrix) {
                v.setFromMatrixColumn(objectMatrix, 0);
                v.multiplyScalar(-distance);
                panOffset.add(v);
            };
        })();

        const panUp = (() => {
            const v = new THREE.Vector3();
            return function panUp(distance, objectMatrix) {
                if (scope.screenSpacePanning === true) {
                    v.setFromMatrixColumn(objectMatrix, 1);
                } else {
                    v.setFromMatrixColumn(objectMatrix, 0);
                    v.crossVectors(scope.object.up, v);
                }
                v.multiplyScalar(distance);
                panOffset.add(v);
            };
        })();

        const pan = (() => {
            const offset = new THREE.Vector3();
            return function pan(deltaX, deltaY) {
                const element = scope.domElement;
                if (scope.object.isPerspectiveCamera) {
                    const position = scope.object.position;
                    offset.copy(position).sub(scope.target);
                    let targetDistance = offset.length();
                    targetDistance *= Math.tan((scope.object.fov / 2) * Math.PI / 180.0);
                    panLeft(2 * deltaX * targetDistance / element.clientHeight, scope.object.matrix);
                    panUp(2 * deltaY * targetDistance / element.clientHeight, scope.object.matrix);
                } else if (scope.object.isOrthographicCamera) {
                    panLeft(deltaX * (scope.object.right - scope.object.left) / scope.object.zoom / element.clientWidth, scope.object.matrix);
                    panUp(deltaY * (scope.object.top - scope.object.bottom) / scope.object.zoom / element.clientHeight, scope.object.matrix);
                } else {
                    console.warn('WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.');
                    scope.enablePan = false;
                }
            };
        })();

        function dollyOut(dollyScale) {
            if (scope.object.isPerspectiveCamera) {
                scale /= dollyScale;
            } else if (scope.object.isOrthographicCamera) {
                scope.object.zoom = Math.max(scope.minZoom, Math.min(scope.maxZoom, scope.object.zoom * dollyScale));
                scope.object.updateProjectionMatrix();
                zoomChanged = true;
            } else {
                console.warn('WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.');
                scope.enableZoom = false;
            }
        }

        function dollyIn(dollyScale) {
            if (scope.object.isPerspectiveCamera) {
                scale *= dollyScale;
            } else if (scope.object.isOrthographicCamera) {
                scope.object.zoom = Math.max(scope.minZoom, Math.min(scope.maxZoom, scope.object.zoom / dollyScale));
                scope.object.updateProjectionMatrix();
                zoomChanged = true;
            } else {
                console.warn('WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.');
                scope.enableZoom = false;
            }
        }

        function handleMouseDownRotate(event) {
            rotateStart.set(event.clientX, event.clientY);
        }

        function handleMouseDownDolly(event) {
            dollyStart.set(event.clientX, event.clientY);
        }

        function handleMouseDownPan(event) {
            panStart.set(event.clientX, event.clientY);
        }

        function handleMouseMoveRotate(event) {
            rotateEnd.set(event.clientX, event.clientY);
            rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(scope.rotateSpeed);
            const element = scope.domElement;
            rotateLeft(2 * Math.PI * rotateDelta.x / element.clientHeight);
            rotateUp(2 * Math.PI * rotateDelta.y / element.clientHeight);
            rotateStart.copy(rotateEnd);
            scope.update();
        }

        function handleMouseMoveDolly(event) {
            dollyEnd.set(event.clientX, event.clientY);
            dollyDelta.subVectors(dollyEnd, dollyStart);
            if (dollyDelta.y > 0) {
                dollyIn(getZoomScale());
            } else if (dollyDelta.y < 0) {
                dollyOut(getZoomScale());
            }
            dollyStart.copy(dollyEnd);
            scope.update();
        }

        function handleMouseMovePan(event) {
            panEnd.set(event.clientX, event.clientY);
            panDelta.subVectors(panEnd, panStart).multiplyScalar(scope.panSpeed);
            pan(panDelta.x, panDelta.y);
            panStart.copy(panEnd);
            scope.update();
        }

        function handleMouseWheel(event) {
            if (event.deltaY < 0) {
                dollyIn(getZoomScale());
            } else if (event.deltaY > 0) {
                dollyOut(getZoomScale());
            }
            scope.update();
        }

        function handleKeyDown(event) {
            let needsUpdate = false;
            switch (event.code) {
                case scope.keys.UP:
                    pan(0, scope.keyPanSpeed);
                    needsUpdate = true;
                    break;
                case scope.keys.BOTTOM:
                    pan(0, -scope.keyPanSpeed);
                    needsUpdate = true;
                    break;
                case scope.keys.LEFT:
                    pan(scope.keyPanSpeed, 0);
                    needsUpdate = true;
                    break;
                case scope.keys.RIGHT:
                    pan(-scope.keyPanSpeed, 0);
                    needsUpdate = true;
                    break;
            }
            if (needsUpdate) {
                event.preventDefault();
                scope.update();
            }
        }

        function handleTouchStartRotate(event) {
            if (event.touches.length == 1) {
                rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
            } else {
                const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
                const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
                rotateStart.set(x, y);
            }
        }

        function handleTouchStartPan(event) {
            if (event.touches.length == 1) {
                panStart.set(event.touches[0].pageX, event.touches[0].pageY);
            } else {
                const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
                const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
                panStart.set(x, y);
            }
        }

        function handleTouchStartDolly(event) {
            const dx = event.touches[0].pageX - event.touches[1].pageX;
            const dy = event.touches[0].pageY - event.touches[1].pageY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            dollyStart.set(0, distance);
        }

        function handleTouchStartDollyPan(event) {
            if (scope.enableZoom) handleTouchStartDolly(event);
            if (scope.enablePan) handleTouchStartPan(event);
        }

        function handleTouchStartDollyRotate(event) {
            if (scope.enableZoom) handleTouchStartDolly(event);
            if (scope.enableRotate) handleTouchStartRotate(event);
        }

        function handleTouchMoveRotate(event) {
            if (event.touches.length == 1) {
                rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
            } else {
                const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
                const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
                rotateEnd.set(x, y);
            }
            rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(scope.rotateSpeed);
            const element = scope.domElement;
            rotateLeft(2 * Math.PI * rotateDelta.x / element.clientHeight);
            rotateUp(2 * Math.PI * rotateDelta.y / element.clientHeight);
            rotateStart.copy(rotateEnd);
        }

        function handleTouchMovePan(event) {
            if (event.touches.length == 1) {
                panEnd.set(event.touches[0].pageX, event.touches[0].pageY);
            } else {
                const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
                const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
                panEnd.set(x, y);
            }
            panDelta.subVectors(panEnd, panStart).multiplyScalar(scope.panSpeed);
            pan(panDelta.x, panDelta.y);
            panStart.copy(panEnd);
        }

        function handleTouchMoveDolly(event) {
            const dx = event.touches[0].pageX - event.touches[1].pageX;
            const dy = event.touches[0].pageY - event.touches[1].pageY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            dollyEnd.set(0, distance);
            dollyDelta.set(0, Math.pow(dollyEnd.y / dollyStart.y, scope.zoomSpeed));
            dollyOut(dollyDelta.y);
            dollyStart.copy(dollyEnd);
        }

        function handleTouchMoveDollyPan(event) {
            if (scope.enableZoom) handleTouchMoveDolly(event);
            if (scope.enablePan) handleTouchMovePan(event);
        }

        function handleTouchMoveDollyRotate(event) {
            if (scope.enableZoom) handleTouchMoveDolly(event);
            if (scope.enableRotate) handleTouchMoveRotate(event);
        }

        function onPointerDown(event) {
            if (scope.enabled === false) return;
            switch (event.pointerType) {
                case 'mouse':
                case 'pen':
                    onMouseDown(event);
                    break;
            }
        }

        function onPointerMove(event) {
            if (scope.enabled === false) return;
            switch (event.pointerType) {
                case 'mouse':
                case 'pen':
                    onMouseMove(event);
                    break;
            }
        }

        function onPointerUp(event) {
            switch (event.pointerType) {
                case 'mouse':
                case 'pen':
                    onMouseUp(event);
                    break;
            }
        }

        function onMouseDown(event) {
            let mouseAction;
            switch (event.button) {
                case 0:
                    mouseAction = scope.enableRotate ? STATE.ROTATE : STATE.PAN;
                    break;
                case 1:
                    mouseAction = scope.enableZoom ? STATE.DOLLY : STATE.PAN;
                    break;
                case 2:
                    mouseAction = scope.enablePan ? STATE.PAN : STATE.ROTATE;
                    break;
                default:
                    mouseAction = -1;
            }

            if (mouseAction !== -1) {
                switch (mouseAction) {
                    case STATE.ROTATE:
                        handleMouseDownRotate(event);
                        break;
                    case STATE.DOLLY:
                        handleMouseDownDolly(event);
                        break;
                    case STATE.PAN:
                        handleMouseDownPan(event);
                        break;
                }
                state = mouseAction;
                scope.domElement.ownerDocument.addEventListener('pointermove', onPointerMove);
                scope.domElement.ownerDocument.addEventListener('pointerup', onPointerUp);
            }
        }

        function onMouseMove(event) {
            if (scope.enabled === false) return;
            switch (state) {
                case STATE.ROTATE:
                    handleMouseMoveRotate(event);
                    break;
                case STATE.DOLLY:
                    handleMouseMoveDolly(event);
                    break;
                case STATE.PAN:
                    handleMouseMovePan(event);
                    break;
            }
        }

        function onMouseUp(event) {
            scope.domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
            scope.domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);
            if (scope.enabled === false) return;
            state = STATE.NONE;
        }

        function onMouseWheel(event) {
            if (scope.enabled === false || scope.enableZoom === false || (state !== STATE.NONE && state !== STATE.ROTATE)) return;
            event.preventDefault();
            scope.dispatchEvent({ type: 'start' });
            handleMouseWheel(event);
            scope.dispatchEvent({ type: 'end' });
        }

        function onKeyDown(event) {
            if (scope.enabled === false || scope.enablePan === false) return;
            handleKeyDown(event);
        }

        function onTouchStart(event) {
            if (scope.enabled === false) return;
            event.preventDefault();
            switch (event.touches.length) {
                case 1:
                    switch (scope.touches.ONE) {
                        case THREE.TOUCH.ROTATE:
                            if (scope.enableRotate === false) return;
                            handleTouchStartRotate(event);
                            state = STATE.TOUCH_ROTATE;
                            break;
                        case THREE.TOUCH.PAN:
                            if (scope.enablePan === false) return;
                            handleTouchStartPan(event);
                            state = STATE.TOUCH_PAN;
                            break;
                        default:
                            state = STATE.NONE;
                    }
                    break;
                case 2:
                    switch (scope.touches.TWO) {
                        case THREE.TOUCH.DOLLY_PAN:
                            if (scope.enableZoom === false && scope.enablePan === false) return;
                            handleTouchStartDollyPan(event);
                            state = STATE.TOUCH_DOLLY_PAN;
                            break;
                        case THREE.TOUCH.DOLLY_ROTATE:
                            if (scope.enableZoom === false && scope.enableRotate === false) return;
                            handleTouchStartDollyRotate(event);
                            state = STATE.TOUCH_DOLLY_ROTATE;
                            break;
                        default:
                            state = STATE.NONE;
                    }
                    break;
                default:
                    state = STATE.NONE;
            }
            if (state !== STATE.NONE) {
                scope.dispatchEvent({ type: 'start' });
            }
        }

        function onTouchMove(event) {
            if (scope.enabled === false) return;
            event.preventDefault();
            switch (state) {
                case STATE.TOUCH_ROTATE:
                    if (scope.enableRotate === false) return;
                    handleTouchMoveRotate(event);
                    scope.update();
                    break;
                case STATE.TOUCH_PAN:
                    if (scope.enablePan === false) return;
                    handleTouchMovePan(event);
                    scope.update();
                    break;
                case STATE.TOUCH_DOLLY_PAN:
                    if (scope.enableZoom === false && scope.enablePan === false) return;
                    handleTouchMoveDollyPan(event);
                    scope.update();
                    break;
                case STATE.TOUCH_DOLLY_ROTATE:
                    if (scope.enableZoom === false && scope.enableRotate === false) return;
                    handleTouchMoveDollyRotate(event);
                    scope.update();
                    break;
                default:
                    state = STATE.NONE;
            }
        }

        function onTouchEnd(event) {
            if (scope.enabled === false) return;
            if (state !== STATE.NONE) {
                scope.dispatchEvent({ type: 'end' });
            }
            state = STATE.NONE;
        }

        function onContextMenu(event) {
            if (scope.enabled === false) return;
            event.preventDefault();
        }

        scope.domElement.addEventListener('contextmenu', onContextMenu);
        scope.domElement.addEventListener('pointerdown', onPointerDown);
        scope.domElement.addEventListener('wheel', onMouseWheel, { passive: false });
        scope.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
        scope.domElement.addEventListener('touchend', onTouchEnd);
        scope.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
        scope.domElement.addEventListener('keydown', onKeyDown);

        this.update();
    }
}

export { OrbitControls };

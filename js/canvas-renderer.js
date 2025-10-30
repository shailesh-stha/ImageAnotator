// js/canvas-renderer.js

// Constants for drawing visual elements
const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 20;

/**
 * @class CanvasRenderer
 * @description Handles all drawing operations on the HTML canvas. It is responsible for rendering the image,
 * annotations, selection handles, and any other visual feedback. It's instantiated by and controlled by the ViewModel.
 */
export class CanvasRenderer {
    /**
     * @constructor
     * @param {HTMLCanvasElement} canvas - The main canvas element.
     * @param {Function} getImage - A function that returns the current image object.
     * @param {Function} getBoxes - A function that returns the array of annotation boxes.
     * @param {Function} getState - A function that returns the current application state object (for scale, pan, etc.).
     */
    constructor(canvas, getImage, getBoxes, getState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.getImage = getImage;
        this.getBoxes = getBoxes;
        this.getState = getState;
    }

    /**
     * @description The main drawing loop. Clears the canvas and redraws the image, all annotations,
     * highlights, handles, and tooltips based on the current state.
     */
    draw() {
        const image = this.getImage();
        if (!image) return;

        const { scale, panX, panY, selectedBoxIds, hoveredBoxId, selectionRect, drawingRect, currentPath, previewPoint, tooltip } = this.getState();
        const boxes = this.getBoxes();
        const ctx = this.ctx;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(scale, scale);

        ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);

        ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
        ctx.lineWidth = 1 / scale;
        ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);

        boxes.forEach(box => {
            if (box.visible !== false) this._drawAnnotation(ctx, box, scale, image);
        });

        const hoveredBox = boxes.find(b => b.id === hoveredBoxId);
        if (hoveredBox) this._drawHighlight(ctx, hoveredBox, scale);

        const selectedBoxes = boxes.filter(b => selectedBoxIds.includes(b.id));
        selectedBoxes.forEach(box => this._drawSelectionHandles(ctx, box, scale));

        if (selectionRect) this._drawSelectionRectangle(ctx, selectionRect, scale);
        if (drawingRect) this._drawDrawingPreview(ctx, drawingRect, scale);

        if (currentPath && currentPath.length > 0) {
            this._drawCurrentPath(ctx, currentPath, previewPoint, scale);
        }

        ctx.restore();

        if (tooltip) this._drawTooltip(ctx, tooltip);
    }

    // --- Internal Drawing Helpers ---

    /**
     * @description Converts a hex color string to an RGBA string.
     * @private
     * @param {string} hex - The hex color (e.g., "#FF0000").
     * @param {number} opacity - The opacity (0 to 1).
     * @returns {string} The RGBA color string.
     */
    _hexToRgba(hex, opacity) {
        hex = String(hex);
        if (hex.startsWith('#')) {
            hex = hex.slice(1);
        }
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        if (hex.length !== 6) {
            console.warn("Invalid hex color:", hex, "Defaulting to black.");
            hex = '000000';
        }
        opacity = Number(opacity);
        if (isNaN(opacity) || opacity < 0 || opacity > 1) {
             console.warn("Invalid opacity:", opacity, "Defaulting to 1.");
            opacity = 1.0;
        }

        return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(
            hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${opacity})`;
    }

    /**
     * @description Draws a semi-transparent highlight over a box.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {object} box - The annotation box to highlight.
     * @param {number} scale - The current canvas scale.
     */
    _drawHighlight(ctx, box, scale) {
        if (box.isTextOnly === true) return;

        ctx.save();
        ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
        ctx.rotate(box.angle);

        const { globalColor } = this.getState();
        ctx.fillStyle = this._hexToRgba(globalColor, 0.2);

        if (box.type === 'poly') {
            const centerX = box.x + box.w / 2;
            const centerY = box.y + box.h / 2;
            ctx.beginPath();
            box.points.forEach((p, i) => {
                const translatedX = p.x - centerX;
                const translatedY = p.y - centerY;
                if (i === 0) ctx.moveTo(translatedX, translatedY);
                else ctx.lineTo(translatedX, translatedY);
            });
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
        }
        ctx.restore();
    }

    /**
     * @description Draws a single annotation (box and text).
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {object} box - The annotation box object.
     * @param {number} scale - The current canvas scale.
     * @param {HTMLImageElement} image - The main image (used for scaling context on export).
     */
    _drawAnnotation(ctx, box, scale, image) {
        const isMainCanvas = ctx === this.ctx;
        const lineWidth = isMainCanvas
            ? 2 / scale
            : 2 * (image.naturalWidth / this.canvas.width);

        const { globalColor, globalOpacity, globalFontSize } = this.getState();

        ctx.save();

        if (box.isTextOnly !== true) {
            ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity);
            ctx.lineWidth = lineWidth;
            
            const dashPattern = [6 / scale, 6 / scale];
            ctx.setLineDash(dashPattern);

            if (box.type === 'poly') {
                ctx.beginPath();
                box.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.stroke();
            } else {
                ctx.save();
                ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
                ctx.rotate(box.angle);
                ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
                ctx.restore();
            }
            
            ctx.setLineDash([]);
        }

        ctx.save();
        ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
        ctx.rotate(box.angle);

        const textMetrics = this._getTextLinesAndHeight(ctx, box, globalFontSize);
        const textBottomWorldY = box.y + box.h/2 + (box.h / 2) * Math.cos(box.angle) + (5/scale) + textMetrics.totalHeight;
        
        const canvasWorldHeight = ctx.canvas.height / (isMainCanvas ? scale : 1);

        const textWouldOverflow = textBottomWorldY > canvasWorldHeight;

        this._drawTextWithWrapping(ctx, box, textWouldOverflow, 1.0, globalFontSize);

        ctx.restore();

        ctx.restore();
    }

    /**
     * @description Draws the path for the pen tool as it's being created.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {Array<{x: number, y: number}>} path - The points in the current path.
     * @param {{x: number, y: number}|null} previewPoint - The current mouse position for previewing the next segment.
     * @param {number} scale - The current canvas scale.
     */
    _drawCurrentPath(ctx, path, previewPoint, scale) {
        const { globalColor, globalOpacity } = this.getState();
        ctx.save();
        ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity);
        ctx.lineWidth = 2 / scale;

        ctx.setLineDash([6 / scale, 6 / scale]);

        ctx.beginPath();
        path.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });

        if (previewPoint) {
            ctx.lineTo(previewPoint.x, previewPoint.y);
        }
        ctx.stroke();
        
        ctx.setLineDash([]);

        ctx.fillStyle = globalColor;
        path.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, (i === 0 ? 6 : 4) / scale, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    /**
     * @description Draws the preview of a rectangle being drawn.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {object} rect - The rectangle dimensions {x, y, w, h}.
     * @param {number} scale - The current canvas scale.
     */
    _drawDrawingPreview(ctx, rect, scale) {
        const { globalColor, globalOpacity } = this.getState();
        ctx.save();
        ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity);
        ctx.lineWidth = 2 / scale;
        
        ctx.setLineDash([6 / scale, 6 / scale]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.setLineDash([]);
        
        ctx.restore();
    }

    /**
     * @description Draws the selection rectangle for cropping.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {object} rect - The rectangle dimensions {x, y, w, h}.
     * @param {number} scale - The current canvas scale.
     */
    _drawSelectionRectangle(ctx, rect, scale) {
        ctx.save();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 3 / scale;
        ctx.setLineDash([6 / scale, 6 / scale]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
    }

    /**
     * @description Draws the selection handles (for resizing and rotating) around a box.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {object} box - The selected annotation box.
     * @param {number} scale - The current canvas scale.
     */
    _drawSelectionHandles(ctx, box, scale) {
        const { globalColor, globalOpacity } = this.getState();
        const handles = this.getHandles(box, scale);

        ctx.fillStyle = this._hexToRgba(globalColor, globalOpacity);
        ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity);
        ctx.lineWidth = 2 / scale;

        if (box.isTextOnly === true) {
            ctx.save();
            ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
            ctx.rotate(box.angle);
            
            ctx.setLineDash([6 / scale, 6 / scale]);
            ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
            ctx.restore();
            
            ctx.beginPath();
            ctx.moveTo(handles.n.x, handles.n.y);
            ctx.lineTo(handles.rotation.x, handles.rotation.y);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(
                handles.rotation.x,
                handles.rotation.y,
                HANDLE_SIZE / 1.5 / scale,
                0,
                Math.PI * 2
            );
            ctx.fill();
            
            return;
        }

        ctx.beginPath();
        ctx.moveTo(handles.n.x, handles.n.y);
        ctx.lineTo(handles.rotation.x, handles.rotation.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(
            handles.rotation.x,
            handles.rotation.y,
            HANDLE_SIZE / 1.5 / scale,
            0,
            Math.PI * 2
        );
        ctx.fill();

        ["nw", "ne", "sw", "se", "n", "s", "w", "e"].forEach((key) => {
            const pos = handles[key];
            ctx.fillRect(
                pos.x - HANDLE_SIZE / 2 / scale,
                pos.y - HANDLE_SIZE / 2 / scale,
                HANDLE_SIZE / scale,
                HANDLE_SIZE / scale
            );
        });
    }

    /**
     * @description Draws a tooltip near the cursor.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {{text: string, x: number, y: number}} tooltip - The tooltip object.
     */
    _drawTooltip(ctx, tooltip) {
        const text = tooltip.text;
        ctx.font = "12px Inter";
        const textWidth = ctx.measureText(text).width;
        const padding = 5;
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(tooltip.x, tooltip.y, textWidth + padding * 2, 20);
        ctx.fillStyle = "white";
        ctx.fillText(text, tooltip.x + padding, tooltip.y + 14);
    }

    /**
     * @description Draws wrapped text for an annotation, positioning it above or below the box.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context to draw on.
     * @param {object} box - The annotation box object containing the text and dimensions.
     * @param {boolean} isOverflowing - If true, text is drawn above the box; otherwise, below.
     * @param {number} opacity - The opacity for the text.
     * @param {number} fontSize - The font size for the text.
     */
    _drawTextWithWrapping(ctx, box, isOverflowing, opacity, fontSize) {
        const text = box.text;
        if (!text || text.trim() === "" || text === "Not defined") return;

        const { scale } = this.getState();
        const textMetrics = this._getTextLinesAndHeight(ctx, box, fontSize);
        const lineHeight = fontSize * 1.2;
        
        const effectiveScale = ctx === this.ctx ? scale : 1;
        const margin = 5 / effectiveScale;

        let y = isOverflowing
                ? -box.h / 2 - textMetrics.totalHeight - margin
                : box.h / 2 + margin;

        const { globalColor } = this.getState();
        ctx.fillStyle = this._hexToRgba(globalColor, opacity);
        ctx.font = `${fontSize}px Inter`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
        ctx.lineWidth = 4 / effectiveScale;
        ctx.lineJoin = "round";

        const drawTextLine = (textLine, x, y) => {
            ctx.strokeText(textLine, x, y);
            ctx.fillText(textLine, x, y);
        };

        textMetrics.lines.forEach((line, index) => {
            drawTextLine(line, 0, y + (index * lineHeight));
        });
    }


    /**
     * @description Calculates the lines and total height for wrapped text within a box.
     * @private
     * @param {CanvasRenderingContext2D} ctx - The canvas context for text measurement.
     * @param {object} box - The annotation box.
     * @param {number} fontSize - The font size.
     * @returns {{lines: string[], totalHeight: number}} The wrapped lines and their total height.
     */
    _getTextLinesAndHeight(ctx, box, fontSize) {
        const text = box.text || "";
        const maxWidth = box.w * 1.2;
        const lineHeight = fontSize * 1.2;
        ctx.font = `${fontSize}px Inter`;

        let lines = [];
        const words = text.split(" ");
        let currentLine = "";

        for (let n = 0; n < words.length; n++) {
            const testLine = currentLine + words[n] + " ";
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && currentLine.length > 0) {
                lines.push(currentLine.trim());
                currentLine = words[n] + " ";
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine.trim());
        lines = lines.filter(line => line.length > 0);
        return { lines, totalHeight: lines.length * lineHeight };
    }


    // --- Utility Methods ---

    /**
     * @description Calculates the screen coordinates of all resize and rotation handles for a box.
     * @param {object} box - The annotation box.
     * @param {number} scale - The current canvas scale.
     * @returns {Object.<string, {x: number, y: number}>} An object mapping handle names to their coordinates.
     */
    getHandles(box, scale) {
        const centerX = box.x + box.w / 2;
        const centerY = box.y + box.h / 2;
        const corners = {
            nw: { x: -box.w / 2, y: -box.h / 2 },
            ne: { x: box.w / 2, y: -box.h / 2 },
            sw: { x: -box.w / 2, y: box.h / 2 },
            se: { x: box.w / 2, y: box.h / 2 },
            n: { x: 0, y: -box.h / 2 },
            s: { x: 0, y: box.h / 2 },
            w: { x: -box.w / 2, y: 0 },
            e: { x: box.w / 2, y: 0 },
            rotation: { x: 0, y: -box.h / 2 - ROTATION_HANDLE_OFFSET / scale },
        };

        const rotatedHandles = {};
        for (const key in corners) {
            const corner = corners[key];
            rotatedHandles[key] = {
                x: centerX + corner.x * Math.cos(box.angle) - corner.y * Math.sin(box.angle),
                y: centerY + corner.x * Math.sin(box.angle) + corner.y * Math.cos(box.angle),
            };
        }
        return rotatedHandles;
    }

    /**
     * @description Checks if a point is inside a rotated bounding box.
     * @param {number} px - The x-coordinate of the point.
     * @param {number} py - The y-coordinate of the point.
     * @param {object} box - The annotation box.
     * @returns {boolean} True if the point is inside the box.
     */
    isPointInBox(px, py, box) {
        if (box.type === 'poly') {
             return this.isPointInPolygon(px, py, box.points);
        }
        const centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
        const dx = px - centerX, dy = py - centerY;
        const angle = -box.angle;
        const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
        return Math.abs(rotatedX) < box.w / 2 && Math.abs(rotatedY) < box.h / 2;
    }

    /**
     * @description Checks if a point is inside a polygon using the ray casting algorithm.
     * @param {number} px - The x-coordinate of the point.
     * @param {number} py - The y-coordinate of the point.
     * @param {Array<{x: number, y: number}>} points - The vertices of the polygon.
     * @returns {boolean} True if the point is inside the polygon.
     */
    isPointInPolygon(px, py, points) {
        let isInside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;

            const intersect = ((yi > py) !== (yj > py))
                            && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);

            if (intersect) {
                isInside = !isInside;
            }
        }
        return isInside;
    }

    /**
     * @description Checks if a point is inside a circle.
     * @param {number} px - The x-coordinate of the point.
     * @param {number} py - The y-coordinate of the point.
     * @param {number} cx - The x-coordinate of the circle's center.
     * @param {number} cy - The y-coordinate of the circle's center.
     * @param {number} r - The radius of the circle.
     * @returns {boolean} True if the point is inside the circle.
     */
    isPointInCircle(px, py, cx, cy, r) {
        const dx = px - cx;
        const dy = py - cy;
        return dx * dx + dy * dy <= r * r;
    }

    /**
     * @description Creates a new, high-resolution canvas with the rendered image and annotations,
     * suitable for exporting or copying. Can crop to a selection rectangle.
     * @param {HTMLImageElement} image - The source image.
     * @param {Array<object>} boxes - The array of annotation boxes.
     * @param {object|null} selectionRect - An optional rectangle to crop the output to.
     * @returns {HTMLCanvasElement} The newly created high-resolution canvas.
     */
    createHighResCanvas(image, boxes, selectionRect) {
        const scaleX = image.naturalWidth / this.canvas.width;
        const scaleY = image.naturalHeight / this.canvas.height;
        
        const exportScale = (scaleX + scaleY) / 2;

        let offscreenCanvas, offscreenCtx;

        const crop = selectionRect
            ? { 
                x: selectionRect.x * exportScale, 
                y: selectionRect.y * exportScale, 
                w: selectionRect.w * exportScale, 
                h: selectionRect.h * exportScale 
              }
            : { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };

        crop.w = Math.max(1, Math.round(crop.w));
        crop.h = Math.max(1, Math.round(crop.h));
        crop.x = Math.round(crop.x);
        crop.y = Math.round(crop.y);


        offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = crop.w;
        offscreenCanvas.height = crop.h;
        offscreenCtx = offscreenCanvas.getContext("2d");

        offscreenCtx.drawImage(
            image,
            crop.x, crop.y, crop.w, crop.h,
            0, 0, crop.w, crop.h
        );

        const originalGetState = this.getState;
        const currentGlobalState = originalGetState();
        
        const highResFontSize = currentGlobalState.globalFontSize * exportScale;
        
        const highResState = {
            ...currentGlobalState,
            scale: 1,
            globalFontSize: highResFontSize,
        };

        this.getState = () => highResState;


        boxes.forEach((box) => {
            if (box.visible === false) return;

            const scaledBox = {
                ...box,
                x: box.x * exportScale - crop.x,
                y: box.y * exportScale - crop.y,
                w: box.w * exportScale,
                h: box.h * exportScale,
            };
            
            if (box.type === 'poly') {
                scaledBox.points = box.points.map(p => ({
                    x: p.x * exportScale - crop.x,
                    y: p.y * exportScale - crop.y
                }));
                if (window.annotationApp && window.annotationApp.model) {
                     const { x: sx, y: sy, w: sw, h: sh } = window.annotationApp.model.calculateBoundingBox(scaledBox.points);
                     scaledBox.x = sx; scaledBox.y = sy; scaledBox.w = sw; scaledBox.h = sh;
                }
            }

            this._drawAnnotation(offscreenCtx, scaledBox, 1, image);
        });

        this.getState = originalGetState;

        return offscreenCanvas;
    }
}

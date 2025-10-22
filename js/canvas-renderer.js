// js/canvas-renderer.js

// Constants for drawing visual elements
const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 20;

export class CanvasRenderer {
    constructor(canvas, getImage, getBoxes, getState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.getImage = getImage;
        this.getBoxes = getBoxes;
        this.getState = getState;
    }

    draw() {
        const image = this.getImage();
        if (!image) return;

        const { scale, panX, panY, selectedBoxId, hoveredBoxId, selectionRect, drawingRect, currentPath, previewPoint, tooltip } = this.getState();
        const boxes = this.getBoxes();
        const ctx = this.ctx;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(scale, scale);

        ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);

        // --- START: Add image border ---
        // This helps define the image boundaries, especially for PNGs with transparency.
        ctx.strokeStyle = "rgba(0, 0, 0, 0.3)"; // A subtle, semi-transparent black border
        ctx.lineWidth = 1 / scale; // A thin 1px line, adjusted for current zoom
        ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
        // --- END: Add image border ---

        boxes.forEach(box => {
            if (box.visible !== false) this._drawAnnotation(ctx, box, scale, image);
        });

        const hoveredBox = boxes.find(b => b.id === hoveredBoxId);
        if (hoveredBox) this._drawHighlight(ctx, hoveredBox, scale);

        const selectedBox = boxes.find(b => b.id === selectedBoxId);
        if (selectedBox) this._drawSelectionHandles(ctx, selectedBox, scale);

        if (selectionRect) this._drawSelectionRectangle(ctx, selectionRect, scale);
        if (drawingRect) this._drawDrawingPreview(ctx, drawingRect, scale);

        if (currentPath && currentPath.length > 0) {
            this._drawCurrentPath(ctx, currentPath, previewPoint, scale);
        }

        ctx.restore();

        if (tooltip) this._drawTooltip(ctx, tooltip);
    }

    // --- Internal Drawing Helpers ---

    _hexToRgba(hex, opacity) {
        // Ensure hex is a string and has the correct format
        hex = String(hex);
        if (hex.startsWith('#')) {
            hex = hex.slice(1);
        }
        // Handle shorthand hex (e.g., #RGB)
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        // Default to black if format is still wrong
        if (hex.length !== 6) {
            console.warn("Invalid hex color:", hex, "Defaulting to black.");
            hex = '000000';
        }
         // Ensure opacity is a number between 0 and 1
        opacity = Number(opacity);
        if (isNaN(opacity) || opacity < 0 || opacity > 1) {
             console.warn("Invalid opacity:", opacity, "Defaulting to 1.");
            opacity = 1.0;
        }

        return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(
            hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${opacity})`;
    }


    _drawHighlight(ctx, box, scale) {
        if (box.isTextOnly === true) return; // Don't highlight text-only boxes

        ctx.save();
        // Translate to the bounding box center for rotation
        ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
        ctx.rotate(box.angle);

        const { globalColor } = this.getState();
        ctx.fillStyle = this._hexToRgba(globalColor, 0.2); // Use global color with low opacity

        if (box.type === 'poly') {
            // Polygon points are absolute, need to translate them relative to the bounding box center for rotated drawing
            const centerX = box.x + box.w / 2;
            const centerY = box.y + box.h / 2;
            ctx.beginPath();
            box.points.forEach((p, i) => {
                 // Translate points to be relative to the bounding box center before rotation is applied
                const translatedX = p.x - centerX;
                const translatedY = p.y - centerY;
                if (i === 0) ctx.moveTo(translatedX, translatedY);
                else ctx.lineTo(translatedX, translatedY);
            });
            ctx.closePath();
            ctx.fill();
        } else {
            // Rectangle highlight is drawn centered at (0,0) in the transformed context
            ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
        }
        ctx.restore();
    }

    _drawAnnotation(ctx, box, scale, image) {
        const isMainCanvas = ctx === this.ctx;
        const lineWidth = isMainCanvas
            ? 2 / scale
            : 2 * (image.naturalWidth / this.canvas.width);

        const { globalColor, globalOpacity, globalFontSize } = this.getState();

        ctx.save(); // Save the initial state for this annotation

        // --- Draw Shape ---
        if (box.isTextOnly !== true) {
            ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity);
            ctx.lineWidth = lineWidth;
            
            // Set a dashed line pattern scaled by the zoom
            const dashPattern = [6 / scale, 6 / scale];
            ctx.setLineDash(dashPattern);

            if (box.type === 'poly') {
                // Polygons use absolute world coordinates - draw them directly
                ctx.beginPath();
                box.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.stroke();
            } else {
                // Rectangles are defined by top-left, w, h - apply transform to draw
                ctx.save(); // Save before transforming for the rectangle
                ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
                ctx.rotate(box.angle);
                ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
                ctx.restore(); // Restore after drawing the rectangle
            }
            
            // Reset line dash to solid for other drawing operations
            ctx.setLineDash([]);
        }

        // --- Draw Text ---
        // Apply transformation to the bounding box center *for text positioning*
        ctx.save(); // Save state specifically for text drawing
        ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
        ctx.rotate(box.angle);

        // Calculate text overflow (relative to the canvas, requires some estimation)
        const textMetrics = this._getTextLinesAndHeight(ctx, box, globalFontSize);
        // Estimate world Y coord of bottom of text IF placed below the box center
        // This is an approximation but good enough for deciding placement
        const textBottomWorldY = box.y + box.h/2 + (box.h / 2) * Math.cos(box.angle) + (5/scale) + textMetrics.totalHeight;
        
        const canvasWorldHeight = ctx.canvas.height / (isMainCanvas ? scale : 1); // Convert canvas height to world coords

        const textWouldOverflow = textBottomWorldY > canvasWorldHeight;

        // Draw text relative to the transformed center (0,0)
        // --- START: MODIFICATION ---
        this._drawTextWithWrapping(ctx, box, textWouldOverflow, 1.0, globalFontSize); // Hardcoded opacity to 1.0
        // --- END: MODIFICATION ---

        ctx.restore(); // Restore state after text drawing (removes text transform)

        ctx.restore(); // Restore the initial state saved at the beginning
    }


    _drawRect(ctx, box) {
        // This function is now only responsible for drawing the rect path
        // Transformations are handled in _drawAnnotation
         ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    }

    _drawPolygon(ctx, box) {
        // This function is now only responsible for drawing the poly path
        // Transformations are handled in _drawAnnotation (for text)
        ctx.beginPath();
        box.points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.stroke();
    }

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
        
        ctx.setLineDash([]); // Reset for other drawing (like the points)

        ctx.fillStyle = globalColor;
        path.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, (i === 0 ? 6 : 4) / scale, 0, Math.PI * 2); // First point bigger
            ctx.fill();
        });
        ctx.restore();
    }

    _drawDrawingPreview(ctx, rect, scale) {
        const { globalColor, globalOpacity } = this.getState();
        ctx.save();
        ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity);
        ctx.lineWidth = 2 / scale;
        
        ctx.setLineDash([6 / scale, 6 / scale]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.setLineDash([]); // Reset
        
        ctx.restore();
    }

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

    _drawSelectionHandles(ctx, box, scale) {
        const { globalColor, globalOpacity } = this.getState();
        const handles = this.getHandles(box, scale);

        ctx.fillStyle = this._hexToRgba(globalColor, globalOpacity);
        ctx.strokeStyle = this._hexToRgba(globalColor, globalOpacity); // Set stroke for lines
        ctx.lineWidth = 2 / scale; // Set line width for lines

        if (box.isTextOnly === true) {
            ctx.save();
            // Translate to the bounding box center for rotation
            ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
            ctx.rotate(box.angle);
            
            // Draw a dashed rectangle instead of resize handles
            ctx.setLineDash([6 / scale, 6 / scale]);
            ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
            ctx.restore();
            
            // Still draw the line to the rotation handle
            ctx.beginPath();
            ctx.moveTo(handles.n.x, handles.n.y);
            ctx.lineTo(handles.rotation.x, handles.rotation.y);
            ctx.stroke();

            // Still draw the rotation handle circle
            ctx.beginPath();
            ctx.arc(
                handles.rotation.x,
                handles.rotation.y,
                HANDLE_SIZE / 1.5 / scale,
                0,
                Math.PI * 2
            );
            ctx.fill();
            
            return; // Stop here, don't draw the resize handles
        }

        // Line to rotation handle
        ctx.beginPath();
        ctx.moveTo(handles.n.x, handles.n.y);
        ctx.lineTo(handles.rotation.x, handles.rotation.y);
        ctx.stroke(); // Use the pre-set strokeStyle and lineWidth

        // Rotation handle circle
        ctx.beginPath();
        ctx.arc(
            handles.rotation.x,
            handles.rotation.y,
            HANDLE_SIZE / 1.5 / scale,
            0,
            Math.PI * 2
        );
        ctx.fill();

        // Resize handle squares
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

    // Draws text relative to the current transform (assumed to be box center)
    _drawTextWithWrapping(ctx, box, isOverflowing, opacity, fontSize) {
        const text = box.text;
        if (!text || text.trim() === "" || text === "Not defined") return; // Don't draw placeholder

        const { scale } = this.getState(); // Need scale for margin calculation
        const textMetrics = this._getTextLinesAndHeight(ctx, box, fontSize);
        const lineHeight = fontSize * 1.2;
        
        // Use scale if it's the main canvas, otherwise use 1
        const effectiveScale = ctx === this.ctx ? scale : 1;
        const margin = 5 / effectiveScale; // 5px margin in world space

        // Position relative to center (0,0 in current transform)
        // Position above top edge if overflowing, otherwise below bottom edge
        let y = isOverflowing
                ? -box.h / 2 - textMetrics.totalHeight - margin
                : box.h / 2 + margin;

        const { globalColor } = this.getState();
        ctx.fillStyle = this._hexToRgba(globalColor, opacity);
        ctx.font = `${fontSize}px Inter`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top"; // Makes positioning easier from the top 'y' coordinate

        // White outline for better readability against complex backgrounds
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
        ctx.lineWidth = 4 / effectiveScale; // Scale outline width based on zoom
        ctx.lineJoin = "round";

        const drawTextLine = (textLine, x, y) => {
            ctx.strokeText(textLine, x, y); // Draw outline first
            ctx.fillText(textLine, x, y);   // Draw filled text on top
        };

        // Draw each line relative to the calculated starting y
        textMetrics.lines.forEach((line, index) => {
            drawTextLine(line, 0, y + (index * lineHeight));
        });
    }



    _getTextLinesAndHeight(ctx, box, fontSize) {
        const text = box.text || "";
        // Use box width for wrapping, allow slightly wider with * 1.2
        const maxWidth = box.w * 1.2;
        const lineHeight = fontSize * 1.2;
        ctx.font = `${fontSize}px Inter`; // Set font for measurement

        let lines = [];
        const words = text.split(" ");
        let currentLine = "";

        for (let n = 0; n < words.length; n++) {
            const testLine = currentLine + words[n] + " ";
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            // If adding the word exceeds max width AND the line isn't empty, push the current line and start a new one
            if (testWidth > maxWidth && currentLine.length > 0) { // Check currentLine length
                lines.push(currentLine.trim());
                currentLine = words[n] + " ";
            } else {
                currentLine = testLine; // Otherwise, add the word to the current line
            }
        }
        lines.push(currentLine.trim()); // Add the last line
        // Filter out empty lines potentially caused by multiple spaces
        lines = lines.filter(line => line.length > 0);
        return { lines, totalHeight: lines.length * lineHeight };
    }


    // --- Utility Methods ---

    getHandles(box, scale) {
        const centerX = box.x + box.w / 2;
        const centerY = box.y + box.h / 2;
        // Handle positions relative to the center before rotation
        const corners = {
            nw: { x: -box.w / 2, y: -box.h / 2 },
            ne: { x: box.w / 2, y: -box.h / 2 },
            sw: { x: -box.w / 2, y: box.h / 2 },
            se: { x: box.w / 2, y: box.h / 2 },
            n: { x: 0, y: -box.h / 2 },
            s: { x: 0, y: box.h / 2 },
            w: { x: -box.w / 2, y: 0 },
            e: { x: box.w / 2, y: 0 },
            rotation: { x: 0, y: -box.h / 2 - ROTATION_HANDLE_OFFSET / scale }, // Offset above the top-middle handle
        };

        const rotatedHandles = {};
        for (const key in corners) {
            const corner = corners[key];
            // Apply rotation formula
            rotatedHandles[key] = {
                x: centerX + corner.x * Math.cos(box.angle) - corner.y * Math.sin(box.angle),
                y: centerY + corner.x * Math.sin(box.angle) + corner.y * Math.cos(box.angle),
            };
        }
        return rotatedHandles;
    }

    isPointInBox(px, py, box) {
        // Use polygon check if it's a polygon
        if (box.type === 'poly') {
             return this.isPointInPolygon(px, py, box.points);
        }
        // Check point against rotated rectangle
        const centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
        const dx = px - centerX, dy = py - centerY;
        const angle = -box.angle; // Rotate point opposite to box rotation
        const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
        // Check if the rotated point is within the unrotated box boundaries
        return Math.abs(rotatedX) < box.w / 2 && Math.abs(rotatedY) < box.h / 2;
    }

    // Ray casting algorithm for point-in-polygon test
    isPointInPolygon(px, py, points) {
        let isInside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;

            // Check if the horizontal ray intersects with the edge
            const intersect = ((yi > py) !== (yj > py)) // Point y is between edge y endpoints
                            && (px < (xj - xi) * (py - yi) / (yj - yi) + xi); // Point x is to the left of the edge's x at point y

            if (intersect) {
                isInside = !isInside; // Flip the inside/outside state
            }
        }
        return isInside;
    }

    isPointInCircle(px, py, cx, cy, r) {
        const dx = px - cx;
        const dy = py - cy;
        return dx * dx + dy * dy <= r * r; // Use squared distance for efficiency
    }

    // Creates a high-resolution canvas for export
    createHighResCanvas(image, boxes, selectionRect) {
        // Calculate the scaling factor from canvas world-space to natural image-space
        const scaleX = image.naturalWidth / this.canvas.width;
        const scaleY = image.naturalHeight / this.canvas.height;
        
        // These should be virtually identical due to aspect-ratio locked resize
        // We average them to account for any minor floating-point discrepancies
        const exportScale = (scaleX + scaleY) / 2;

        let offscreenCanvas, offscreenCtx;

        // Determine crop area based on selectionRect or full image
        // selectionRect is in WORLD coordinates (i.e., 0 -> canvas.width)
        // We must scale it to NATURAL IMAGE coordinates for cropping
        const crop = selectionRect
            ? { 
                x: selectionRect.x * exportScale, 
                y: selectionRect.y * exportScale, 
                w: selectionRect.w * exportScale, 
                h: selectionRect.h * exportScale 
              }
            : { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };

        // Ensure crop dimensions are valid integers
        crop.w = Math.max(1, Math.round(crop.w));
        crop.h = Math.max(1, Math.round(crop.h));
        crop.x = Math.round(crop.x);
        crop.y = Math.round(crop.y);


        offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = crop.w;
        offscreenCanvas.height = crop.h;
        offscreenCtx = offscreenCanvas.getContext("2d");

        // Draw the (potentially cropped) image onto the offscreen canvas
        offscreenCtx.drawImage(
            image,
            crop.x, crop.y, crop.w, crop.h, // Source rectangle (from original image)
            0, 0, crop.w, crop.h          // Destination rectangle (on offscreen canvas)
        );

        // --- Draw Annotations on High-Res Canvas ---
        // Need global styles scaled appropriately for high-res
        const originalGetState = this.getState;
        const currentGlobalState = originalGetState(); // Get current global state
        
        // Scale font size based on the export scale
        const highResFontSize = currentGlobalState.globalFontSize * exportScale;
        
        const highResState = {
            ...currentGlobalState, // Copy all existing state
            scale: 1, // Use scale 1 for drawing on offscreen canvas
            globalFontSize: highResFontSize, // Use scaled font size
        };

        // Temporarily override getState for offscreen drawing context
        this.getState = () => highResState;


        boxes.forEach((box) => {
            if (box.visible === false) return;

            // Create a scaled copy of the box data for drawing
            // Box coordinates are in WORLD coordinates (0 -> canvas.width)
            const scaledBox = {
                ...box, // Copy type, text, angle etc.
                // Scale and offset coordinates relative to the crop area
                x: box.x * exportScale - crop.x,
                y: box.y * exportScale - crop.y,
                w: box.w * exportScale,
                h: box.h * exportScale,
                // Angle remains the same
                // Text remains the same
            };
            
            // Scale points if it's a polygon
            if (box.type === 'poly') {
                scaledBox.points = box.points.map(p => ({
                    x: p.x * exportScale - crop.x,
                    y: p.y * exportScale - crop.y
                }));
                 // Recalculate bounding box based on scaled points for text positioning
                if (window.annotationApp && window.annotationApp.model) {
                     const { x: sx, y: sy, w: sw, h: sh } = window.annotationApp.model.calculateBoundingBox(scaledBox.points);
                     scaledBox.x = sx; scaledBox.y = sy; scaledBox.w = sw; scaledBox.h = sh;
                }
            }

            // Draw using the renderer's internal method, passing scale 1
            // _drawAnnotation will use the overridden highResState for styles
            this._drawAnnotation(offscreenCtx, scaledBox, 1, image);
        });

         // Restore original getState function
        this.getState = originalGetState;

        return offscreenCanvas;
    }
}
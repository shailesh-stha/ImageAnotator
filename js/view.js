// js/view.js

export class AnnotationView {
    constructor(canvas) {
        // --- Core DOM Elements ---
        this.DOMElements = {
            canvas: canvas,
            ctx: canvas.getContext("2d"), // <-- FIX: Added context reference
            imageLoader: document.getElementById("imageLoader"),
            jsonLoader: document.getElementById("jsonLoader"),
            uploadBtn: document.getElementById("uploadBtn"),
            addBoxBtn: document.getElementById("addBoxBtn"),
            penToolBtn: document.getElementById("penToolBtn"),
            addTextBtn: document.getElementById("addTextBtn"),
            exportBtn: document.getElementById("exportBtn"),
            deleteBtn: document.getElementById("deleteBtn"),
            colorPicker: document.getElementById("colorPicker"),

            fontSizeSlider: document.getElementById("fontSize"),
            fontSizeValueInput: document.getElementById("fontSizeValueInput"),
            fontSizeDownBtn: document.getElementById("fontSizeDownBtn"),
            fontSizeUpBtn: document.getElementById("fontSizeUpBtn"),
            opacitySlider: document.getElementById("opacity"),
            opacityValueInput: document.getElementById("opacityValueInput"),
            opacityDownBtn: document.getElementById("opacityDownBtn"),
            opacityUpBtn: document.getElementById("opacityUpBtn"),

            canvasContainer: document.getElementById("canvasContainer"),
            placeholder: document.getElementById("placeholder"),
            loadingIndicator: document.getElementById("loadingIndicator"),
            unloadImageBtn: document.getElementById("unloadImageBtn"),
            annotationList: document.getElementById("annotationList"),
            undoBtn: document.getElementById("undoBtn"),
            redoBtn: document.getElementById("redoBtn"),
            toastContainer: document.getElementById("toastContainer"),
            exportModal: document.getElementById("exportModal"),
            closeModalBtn: document.getElementById("closeModalBtn"),
            copyToClipboardBtn: document.getElementById("copyToClipboardBtn"),
            saveToFileBtn: document.getElementById("saveToFileBtn"),
            saveJsonBtn: document.getElementById("saveJsonBtn"),

            resetViewBtn: document.getElementById("resetViewBtn"),
            resetStylesBtn: document.getElementById("resetStylesBtn"),
            aspectRatioSelect: document.getElementById("aspectRatioSelect"),
            drawSelectionBtn: document.getElementById("drawSelectionBtn"),

            toolsToggleBtn: document.getElementById("toolsToggleBtn"),
            toolsPanel: document.getElementById("toolsPanel"),
            propertiesToggleBtn: document.getElementById("propertiesToggleBtn"),
            propertiesPanel: document.getElementById("propertiesPanel"),

            canvasControls: document.getElementById("canvasControls"),
            zoomInBtn: document.getElementById("zoomInBtn"),
            zoomOutBtn: document.getElementById("zoomOutBtn"),
            zoomLevelDisplay: document.getElementById("zoomLevelDisplay"),
            fitToScreenBtn: document.getElementById("fitToScreenBtn"),
            unloadConfirmModal: document.getElementById("unloadConfirmModal"),
            confirmUnloadBtn: document.getElementById("confirmUnloadBtn"),
            cancelUnloadBtn: document.getElementById("cancelUnloadBtn"),
            helpModal: document.getElementById("helpModal"),
            closeHelpModalBtn: document.getElementById("closeHelpModalBtn"),
        };

        // --- Transient View State ---
        this.isEditingText = false;
        this.tooltip = null;
    }

    showLoadingIndicator() {
        this.DOMElements.loadingIndicator.classList.remove("hidden");
    }

    hideLoadingIndicator() {
        this.DOMElements.loadingIndicator.classList.add("hidden");
    }

    // --- Public UI Update Methods (Called by ViewModel) ---

    updateImageStatus(hasImage) {
        const {
            placeholder, unloadImageBtn, exportBtn, resetViewBtn,
            addBoxBtn, penToolBtn, addTextBtn,
            canvasControls, ctx, canvas // <-- FIX: Added ctx and canvas
        } = this.DOMElements;

        placeholder.classList.toggle("hidden", hasImage);
        unloadImageBtn.classList.toggle("hidden", !hasImage);
        resetViewBtn.classList.toggle("hidden", !hasImage); // This is inside canvasControls now
        canvasControls.classList.toggle("hidden", !hasImage);
        if (!hasImage) {
            canvasControls.classList.remove('flex');
            // <-- FIX: Explicitly clear canvas on unload -->
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
             canvasControls.classList.add('flex');
        }

        exportBtn.disabled = !hasImage;

        addBoxBtn.disabled = !hasImage;
        penToolBtn.disabled = !hasImage;
        addTextBtn.disabled = !hasImage;
    }

    updateUndoRedoButtons(canUndo, canRedo) {
        this.DOMElements.undoBtn.disabled = !canUndo;
        this.DOMElements.redoBtn.disabled = !canRedo;
    }

    updateDeleteButton(selectedIds) {
        this.DOMElements.deleteBtn.disabled = selectedIds.length === 0;
    }

    updateGlobalStyleControls(styleState) {
        const { colorPicker, fontSizeSlider, fontSizeValueInput, opacitySlider, opacityValueInput } = this.DOMElements;

        colorPicker.value = styleState.color;

        fontSizeSlider.value = styleState.fontSize;
        fontSizeValueInput.value = styleState.fontSize;

        opacitySlider.value = styleState.opacity * 100;
    updateGlobalStyleControls(styleState) {
        const { colorPicker, fontSizeSlider, fontSizeValueInput, opacitySlider, opacityValueInput } = this.DOMElements;

        colorPicker.value = styleState.color;

        fontSizeSlider.value = styleState.fontSize;
        fontSizeValueInput.value = styleState.fontSize;

        opacitySlider.value = styleState.opacity * 100;
        opacityValueInput.value = Math.round(styleState.opacity * 100);
    }

    updateAnnotationHighlight(annotationId, isHovered) {
        const item = this.DOMElements.annotationList.querySelector(`[data-id="${annotationId}"]`);
        if (item) {
            item.classList.toggle('hovered', isHovered);
        }
    }

    updateToolHighlights(activeTool) {
        const { addBoxBtn, penToolBtn, addTextBtn } = this.DOMElements;
        [addBoxBtn, penToolBtn, addTextBtn].forEach(btn => {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        });

        if (activeTool === 'bbox') {
            addBoxBtn.classList.add('btn-primary');
            addBoxBtn.classList.remove('btn-secondary');
        } else if (activeTool === 'pen') {
            penToolBtn.classList.add('btn-primary');
            penToolBtn.classList.remove('btn-secondary');
        } else if (activeTool === 'text') {
            addTextBtn.classList.add('btn-primary');
            addTextBtn.classList.remove('btn-secondary');
        }
    }

    updateAnnotationList(boxes, selectedIds, handlers) {
        const { annotationList } = this.DOMElements;
        annotationList.innerHTML = "";

        // <-- FIX: Correctly check if image exists in the model -->
        const imageExists = window.annotationApp && window.annotationApp.model && window.annotationApp.model.image;

        if (boxes.length === 0) {
            annotationList.innerHTML = `<p id="annotationListPlaceholder" class="text-sm text-gray-500 italic">${
                imageExists ? "No annotations yet." : "Upload an image to start."
            }</p>`;
            return;
        }

        boxes.forEach((box) => {
            const item = document.createElement("div");
            item.className = `annotation-item p-2 rounded-md cursor-pointer flex justify-between items-center text-sm ${
                selectedIds.includes(box.id) ? "bg-indigo-100" : "hover:bg-gray-100"
            }`;
            item.dataset.id = box.id;

            item.addEventListener("click", (e) => handlers.onAnnotationListClick(box.id, e.ctrlKey || e.metaKey));
            item.addEventListener("mouseenter", () => handlers.onAnnotationListHover(box.id));
            item.addEventListener("mouseleave", () => handlers.onAnnotationListLeave());

            const textSpan = document.createElement("span");
            textSpan.textContent = box.text || `Annotation #${box.id} (${box.type})`;
            textSpan.className = "truncate mr-2"; // Added margin-right
            item.appendChild(textSpan);

            const btnGroup = document.createElement("div");
            btnGroup.className = "list-item-btn-group ml-auto"; // Added ml-auto

            const editBtn = document.createElement("button");
            editBtn.className = "list-item-btn edit";
            editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg>`;
            editBtn.title = "Edit text";
            editBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                // <-- FIX: Ensure double-click handler is called correctly -->
                handlers.onEditAnnotation(e, box.id); // Pass box id
            });

            const deleteListBtn = document.createElement("button");
            deleteListBtn.className = "list-item-btn delete";
            deleteListBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.22-2.365.468a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193v-.443A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0 .69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd" /></svg>`;
            deleteListBtn.title = "Delete annotation";
            deleteListBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                handlers.onDeleteAnnotation(box.id);
            });

            const copyBtn = document.createElement("button");
            copyBtn.className = "list-item-btn copy";
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path d="M7 3.5A1.5 1.5 0 018.5 2h6.5A1.5 1.5 0 0116.5 3.5v6.5a1.5 1.5 0 01-1.5 1.5h-1.879a.75.75 0 00-.53.22l-2.122 2.121a.75.75 0 01-1.06 0l-2.122-2.121a.75.75 0 00-.53-.22H4.5A1.5 1.5 0 013 10V5.5A2.5 2.5 0 015.5 3H7v.5z" /><path d="M5 6.5a.5.5 0 00-.5.5v8.5a1.5 1.5 0 001.5 1.5h8.5a.5.5 0 00.5-.5v-1.5a.75.75 0 011.5 0V16a2 2 0 01-2 2H6a3 3 0 01-3-3V7a1 1 0 011-1h1z" /></svg>`;
            copyBtn.title = "Duplicate annotation";
            copyBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                handlers.onCopyAnnotation(box.id);
            });

            btnGroup.appendChild(editBtn);
            btnGroup.appendChild(copyBtn);
            btnGroup.appendChild(deleteListBtn);
            item.appendChild(btnGroup);
            annotationList.appendChild(item);
        });
    }

    // --- Feedback & Modal Methods ---

    showToast(message, type = "success") {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        this.DOMElements.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 4500);
    }

    openExportModal() {
        // <-- FIX: Ensure window.annotationApp exists before accessing model -->
        const hasAnnotations = window.annotationApp && window.annotationApp.model && window.annotationApp.model.boxes.length > 0;
        this.DOMElements.saveJsonBtn.disabled = !hasAnnotations;

        this.DOMElements.exportModal.classList.remove("hidden");
    }

    closeExportModal() {
        this.DOMElements.exportModal.classList.add("hidden");
    }

    updateZoomDisplay(scale) {
        const percentage = Math.round(scale * 100);
        this.DOMElements.zoomLevelDisplay.textContent = `${percentage}%`;
    }

    showUnloadConfirmModal() {
        this.DOMElements.unloadConfirmModal.classList.remove("hidden");
        this.DOMElements.confirmUnloadBtn.focus();
    }

    hideUnloadConfirmModal() {
        this.DOMElements.unloadConfirmModal.classList.add("hidden");
    }

    showHelpModal() {
        this.DOMElements.helpModal.classList.remove("hidden");
    }

    hideHelpModal() {
        this.DOMElements.helpModal.classList.add("hidden");
    }

    createTextInput(box, cleanupCallback) {
        if (!window.annotationApp || !window.annotationApp.worldToScreen) {
            console.error("ViewModel utility not available. Cannot position text input.");
            return;
        }

        // <-- FIX: Remove existing input if one is already present -->
        const existingInput = document.getElementById('annotation-text-input');
        if (existingInput) {
            existingInput.blur(); // Trigger cleanup of the old one
        }

        this.isEditingText = true;
        const vm = window.annotationApp;
        const scale = vm.model.scale;

        const input = document.createElement("input");
        input.id = 'annotation-text-input'; // <-- FIX: Added ID for easier removal
        input.type = "text";
        input.value = box.text === "Not defined" ? "" : box.text;

        // Calculate position based on box center and angle
        const centerX = box.x + box.w / 2;
        const centerY = box.y + box.h / 2;
        
        // Position slightly below the center, adjusted for rotation and scale
        const offsetYWorld = (box.h / 2) + (10 / scale); // 10px below in screen space
        
        const worldX = centerX + offsetYWorld * Math.sin(box.angle);
        const worldY = centerY + offsetYWorld * Math.cos(box.angle);


        const screenPos = vm.worldToScreen(worldX, worldY);

        input.style.position = "absolute";
        input.style.left = `${screenPos.x}px`;
        input.style.top = `${screenPos.y}px`;
        input.style.zIndex = "100";
        input.style.textAlign = "center";
        
        // Rotate around the center of the input itself
        input.style.transform = `translate(-50%, -50%) rotate(${box.angle}rad)`; 
        input.style.transformOrigin = "center center";

        input.style.font = `${vm.model.globalFontSize * scale}px Inter`;
        input.style.border = `1px solid ${vm.model.globalColor}`;
        input.style.padding = '2px 4px'; // Added padding
        input.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'; // Slight background
        input.style.minWidth = `${Math.max(box.w * scale, 80)}px`; // Ensure minimum width
        input.style.maxWidth = '300px'; // Prevent excessive width

        const cleanup = (saveValue = true) => {
            if (!this.isEditingText) return; // Prevent double cleanup
            this.isEditingText = false;
            if (saveValue) {
                cleanupCallback(input.value);
            }
             if (document.body.contains(input)) {
                 document.body.removeChild(input);
             }
             // Restore focus to canvas or body to allow keyboard shortcuts again
             this.DOMElements.canvas.focus();
        };

        input.addEventListener("blur", () => cleanup(true)); // Save on blur
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault(); // Prevent potential form submission
                cleanup(true); // Save on Enter
            }
            if (e.key === "Escape") {
                 cleanup(false); // Discard changes on Escape
            }
        });

        document.body.appendChild(input);
        input.focus();
        input.select();
    }

    updateCanvasDrawingMode(isPanning, isDrawingSelection) {
        const { canvas } = this.DOMElements;
        canvas.classList.remove("panning", "drawing");
        if (isPanning) {
            canvas.classList.add("panning");
            canvas.style.cursor = "grab";
        } else if (isDrawingSelection) {
             canvas.classList.add("drawing");
             canvas.style.cursor = "crosshair";
        }
         // <-- FIX: Ensure cursor resets correctly when panning stops -->
         else if (!isPanning && !isDrawingSelection && !window.annotationApp.isDrawingMode && !window.annotationApp.isPenMode && !window.annotationApp.isTextMode) {
            canvas.style.cursor = 'default';
        }
    }

    // --- Event Binding ---

    bindEventListeners(handlers) {
        const d = this.DOMElements;

        d.toolsToggleBtn.addEventListener("click", handlers.onToggleTools);
        d.propertiesToggleBtn.addEventListener("click", handlers.onToggleProperties);

        // File/Actions
        d.uploadBtn.addEventListener("click", handlers.onUploadClick);
        d.imageLoader.addEventListener("change", (e) => handlers.onImageLoad(e.target.files[0]));
        d.unloadImageBtn.addEventListener("click", handlers.onShowUnloadConfirm);
        d.exportBtn.addEventListener("click", handlers.onOpenExportModal);
        d.closeModalBtn.addEventListener("click", handlers.onCloseExportModal);
        d.copyToClipboardBtn.addEventListener("click", handlers.onCopyImageAndPrompt);
        d.saveToFileBtn.addEventListener("click", handlers.onSaveImageToFile);
        d.saveJsonBtn.addEventListener("click", handlers.onSaveJson);
        d.jsonLoader.addEventListener("change", (e) => handlers.onImportAnnotations(e.target.files[0]));

        // Controls
        d.addBoxBtn.addEventListener("click", handlers.onAddBox);
        d.penToolBtn.addEventListener("click", handlers.onPenToolClick);
        d.addTextBtn.addEventListener("click", handlers.onAddText);
        d.deleteBtn.addEventListener("click", handlers.onDeleteSelected);
        d.undoBtn.addEventListener("click", handlers.onUndoClick);
        d.redoBtn.addEventListener("click", handlers.onRedoClick);
        d.resetViewBtn.addEventListener("click", handlers.onResetView);
        d.resetStylesBtn.addEventListener("click", handlers.onResetStyles);
        d.drawSelectionBtn.addEventListener("click", handlers.onToggleSelectionDrawing);
        d.aspectRatioSelect.addEventListener("change", (e) => handlers.onAspectRatioChange(e.target.value));

        // Global Style Inputs
        d.colorPicker.addEventListener("input", (e) => handlers.onStyleChange("color", e.target.value));

        d.fontSizeSlider.addEventListener("input", (e) => handlers.onStyleChange("fontSize", parseInt(e.target.value, 10)));
        d.fontSizeDownBtn.addEventListener("click", handlers.onFontSizeDown);
        d.fontSizeUpBtn.addEventListener("click", handlers.onFontSizeUp);
        d.fontSizeValueInput.addEventListener("blur", handlers.onFontSizeInput);
        d.fontSizeValueInput.addEventListener("keydown", (e) => { if (e.key === 'Enter') e.target.blur(); });

        d.opacitySlider.addEventListener("input", (e) => handlers.onStyleChange("opacity", parseFloat(e.target.value) / 100));
        d.opacityDownBtn.addEventListener("click", handlers.onOpacityDown);
        d.opacityUpBtn.addEventListener("click", handlers.onOpacityUp);
        d.opacityValueInput.addEventListener("blur", handlers.onOpacityInput);
        d.opacityValueInput.addEventListener("keydown", (e) => { if (e.key === 'Enter') e.target.blur(); });

        // Canvas Events
        d.canvas.addEventListener("mousedown", handlers.onCanvasMouseDown);
        d.canvas.addEventListener("mousemove", handlers.onCanvasMouseMove);
        d.canvas.addEventListener("mouseup", handlers.onCanvasMouseUp);
        d.canvas.addEventListener("dblclick", handlers.onCanvasDoubleClick);
        d.canvas.addEventListener("wheel", handlers.onCanvasWheel, { passive: false });
        // <-- FIX: Add focus/blur to handle keyboard shortcuts correctly -->
        d.canvas.setAttribute('tabindex', '0'); // Make canvas focusable
        d.canvas.addEventListener('focus', handlers.onCanvasFocus);
        d.canvas.addEventListener('blur', handlers.onCanvasBlur);


        // Global Events
        window.addEventListener("resize", handlers.onWindowResize);
        document.addEventListener("keydown", handlers.onKeyDown);
        document.addEventListener("keyup", handlers.onKeyUp);

        // Drag and Drop
        d.canvasContainer.addEventListener("drop", handlers.onCanvasDrop);
        d.canvasContainer.addEventListener("dragover", (e) => {
             e.preventDefault(); e.stopPropagation(); d.canvasContainer.style.backgroundColor = "#e0e7ff";
        });
        d.canvasContainer.addEventListener("dragleave", () => {
             d.canvasContainer.style.backgroundColor = "";
        });

        // Modal Events
        d.zoomInBtn.addEventListener("click", handlers.onZoomIn);
        d.zoomOutBtn.addEventListener("click", handlers.onZoomOut);
        d.fitToScreenBtn.addEventListener("click", handlers.onFitToScreen);
        d.confirmUnloadBtn.addEventListener("click", handlers.onConfirmUnload);
        d.cancelUnloadBtn.addEventListener("click", handlers.onCancelUnload);
        d.unloadConfirmModal.addEventListener("keydown", (e) => {
            if (e.key === 'Escape') handlers.onCancelUnload();
             // <-- FIX: Allow Enter on focused 'Yes' button -->
            if (e.key === 'Enter' && document.activeElement === d.confirmUnloadBtn) {
                 handlers.onConfirmUnload();
             }
        });

        d.closeHelpModalBtn.addEventListener("click", handlers.onCloseHelpModal);
    }
}
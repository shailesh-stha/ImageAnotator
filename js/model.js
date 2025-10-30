// js/model.js

// Constants (now centralized in the Model)
export const DEFAULT_COLOR = "#FF0000";
export const DEFAULT_FONT_SIZE = 13;
export const DEFAULT_OPACITY = 1.0;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 5.0;

/**
 * @class AnnotationModel
 * @description Manages the application's state, including annotations, history, and styling.
 */
export class AnnotationModel {
    constructor() {
        // --- Core Application State ---
        this.image = null;             // The Image object loaded
        this.boxes = [];               // Array of annotation objects
        this.selectedBoxIds = [];     // IDs of the currently selected boxes
        this.nextId = 0;               // Counter for new box IDs
        
        // --- View Transform State (Persistent) ---
        this.scale = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.selectionRect = null;     // {x, y, w, h} of the current selection box
        
        // --- Global Styling State ---
        this.globalColor = DEFAULT_COLOR;
        this.globalFontSize = DEFAULT_FONT_SIZE;
        this.globalOpacity = DEFAULT_OPACITY;

        // --- History Management State ---
        this.history = [];             // Stack of previous box states
        this.redoStack = [];           // Stack of undone states
        this.isUndoRedoAction = false; // Flag to prevent history loops
        
        // Initial save to history (for the empty state)
        this.saveState();
    }

    // --- Annotation Accessors/Mutators ---

    /**
     * @returns {Array} A deep copy of the current annotations.
     */
    get currentAnnotations() {
        return JSON.parse(JSON.stringify(this.boxes));
    }
    
    /**
     * @param {Array} newBoxes The new array of annotations.
     */
    set currentAnnotations(newBoxes) {
        this.boxes = newBoxes;
        this.nextId = newBoxes.length 
            ? Math.max(...newBoxes.map(b => b.id), 0) + 1 
            : 0;
    }

    /**
     * Adds a new bounding box annotation.
     * @param {Object} box - The bounding box to add.
     * @returns {Object} The new bounding box.
     */
    addBox({ x, y, w, h }) {
        const newBox = {
            id: this.nextId++,
            type: 'rect',
            x, y, w, h,
            angle: 0,
            text: "Not defined",
            // Note: color, fontSize, and opacity are no longer stored here
        };
        this.boxes.push(newBox);
        return newBox;
    }

    /**
     * Duplicates an existing annotation by its ID.
     * @param {number} idToCopy - The ID of the annotation to copy.
     * @returns {Object|null} The new annotation, or null if the original was not found.
     */
    copyBox(idToCopy) {
        const boxToCopy = this.boxes.find(box => box.id === idToCopy);
        if (!boxToCopy) return null;

        const newBox = JSON.parse(JSON.stringify(boxToCopy)); // Deep copy
        newBox.id = this.nextId++;
        newBox.x += 10; // Offset the new box slightly
        newBox.y += 10;

        if (newBox.type === 'poly') {
            newBox.points = newBox.points.map(p => ({ x: p.x + 10, y: p.y + 10 }));
        }

        this.boxes.push(newBox);
        return newBox;
    }

    /**
     * Adds a new polygon annotation from a set of points.
     * @param {Array<Object>} points - The points of the polygon.
     * @returns {Object} The new polygon annotation.
     */
    addPolygon(points) {
        const { x, y, w, h } = this.calculateBoundingBox(points);
        const newPoly = {
            id: this.nextId++,
            type: 'poly',
            points: points,
            x, y, w, h, // Store calculated bounding box for editing
            angle: 0,
            text: "Not defined",
            // Note: color, fontSize, and opacity are no longer stored here
        };
        this.boxes.push(newPoly);
        return newPoly;
    }

    /**
     * Deletes an annotation by its ID.
     * @param {number} idToDelete - The ID of the annotation to delete.
     */
    deleteBox(idToDelete) {
        this.boxes = this.boxes.filter(box => box.id !== idToDelete);
    }
    
    // --- History Management Methods ---

    /**
     * Saves the current state of the annotations to the history stack.
     */
    saveState() {
        if (this.isUndoRedoAction) return;
        this.history.push(this.currentAnnotations);
        this.redoStack = [];
    }
    
    /**
     * Reverts to the previous state in the history.
     * @returns {boolean} - True if the undo was successful, false otherwise.
     */
    undo() {
        if (this.history.length <= 1) return false;
        this.isUndoRedoAction = true;
        this.redoStack.push(this.history.pop());
        this.currentAnnotations = this.history[this.history.length - 1];
        this.isUndoRedoAction = false;
        return true;
    }
    
    /**
     * Re-applies the next undone state from the redo stack.
     * @returns {boolean} - True if the redo was successful, false otherwise.
     */
    redo() {
        if (this.redoStack.length === 0) return false;
        this.isUndoRedoAction = true;
        const nextState = this.redoStack.pop();
        this.history.push(nextState);
        this.currentAnnotations = nextState;
        this.isUndoRedoAction = false;
        return true;
    }

    // --- Utility Methods ---
    
    /**
     * Calculates the bounding box for a set of polygon points.
     * @param {Array<Object>} points - The points of the polygon.
     * @returns {Object} - The bounding box.
     */
    calculateBoundingBox(points) {
        const xCoords = points.map(p => p.x);
        const yCoords = points.map(p => p.y);
        const minX = Math.min(...xCoords);
        const minY = Math.min(...yCoords);
        const maxX = Math.max(...xCoords);
        const maxY = Math.max(...yCoords);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    
    /**
     * Resets the global styling properties to their default values.
     */
    resetGlobalStyles() {
        this.globalColor = DEFAULT_COLOR;
        this.globalFontSize = DEFAULT_FONT_SIZE;
        this.globalOpacity = DEFAULT_OPACITY;
    }

    /**
     * Resets the entire application state.
     */
    resetAppState() {
        this.image = null;
        this.boxes = [];
        this.selectedBoxId = null;
        this.nextId = 0;
        this.scale = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.selectionRect = null;
        this.history = [];
        this.redoStack = [];
        this.saveState(); // Save the new empty state
    }
}
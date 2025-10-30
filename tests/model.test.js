import { AnnotationModel } from '../js/model.js';

describe('AnnotationModel', () => {
  let model;

  beforeEach(() => {
    model = new AnnotationModel();
  });

  it('should add a box', () => {
    model.addBox({ x: 10, y: 20, w: 30, h: 40 });
    expect(model.boxes.length).toBe(1);
    expect(model.boxes[0]).toEqual(expect.objectContaining({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    }));
  });

  it('should delete a box', () => {
    const box = model.addBox({ x: 10, y: 20, w: 30, h: 40 });
    model.deleteBox(box.id);
    expect(model.boxes.length).toBe(0);
  });

  it('should copy a box', () => {
    const box = model.addBox({ x: 10, y: 20, w: 30, h: 40 });
    const newBox = model.copyBox(box.id);
    expect(model.boxes.length).toBe(2);
    expect(newBox).toEqual(expect.objectContaining({
        x: 20,
        y: 30,
        w: 30,
        h: 40,
    }));
    });
});

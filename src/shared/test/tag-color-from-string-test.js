import {
  hexColorInputToRgba,
  highlightRgbaFromString,
  rgbaStringToHexColorInput,
  TAG_HIGHLIGHT_ALPHA,
} from '../tag-color-from-string';

describe('shared/tag-color-from-string', () => {
  describe('#highlightRgbaFromString', () => {
    it('returns stable output for the same input', () => {
      const a = highlightRgbaFromString('my-schema');
      const b = highlightRgbaFromString('my-schema');
      assert.equal(a, b);
    });

    it('returns rgba with configured alpha', () => {
      const out = highlightRgbaFromString('x');
      assert.isTrue(
        new RegExp(`^rgba\\(\\d+, \\d+, \\d+, ${TAG_HIGHLIGHT_ALPHA}\\)$`).test(out),
      );
    });

    it('treats differing strings as likely different colors', () => {
      const a = highlightRgbaFromString('aaa');
      const b = highlightRgbaFromString('bbb');
      assert.notEqual(a, b);
    });
  });

  describe('#rgbaStringToHexColorInput and #hexColorInputToRgba', () => {
    it('round-trips rgb channels at fixed alpha', () => {
      const rgba = 'rgba(10, 20, 30, 0.38)';
      const hex = rgbaStringToHexColorInput(rgba);
      assert.equal(hex, '#0a141e');
      const back = hexColorInputToRgba(hex, 0.38);
      assert.equal(back, 'rgba(10, 20, 30, 0.38)');
    });
  });
});

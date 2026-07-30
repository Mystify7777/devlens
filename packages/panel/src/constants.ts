/**
 * Cap on rendered DOM rows, enforced by panel.ts before calling
 * renderer.render() — see ADR-0008 Performance section. The renderer
 * itself has no opinion about this number; it only draws what it's given.
 */
export const MAX_RENDERED_EVENTS = 300;
import { describe, expect, test } from "bun:test";
import { startedGame } from "../game/test-kit.ts";
import { svgToPng } from "./map-png.ts";
import { renderMapSvg } from "./map-svg.ts";

describe("map rendering", () => {
  test("draws every tile with its resource, every vertex label, and the starting buildings", async () => {
    const { game } = await startedGame({ seed: 42 });
    const board = (await game.board())!;
    const svg = renderMapSvg(board, { title: "Osada – sezóna 1" });
    expect(svg.match(/class="tile /g)).toHaveLength(19);
    expect(svg.match(/class="tile tile-desert"/g)).toHaveLength(1);
    expect(svg).toContain(">Ruda<");
    expect(svg).toContain(">Pustina<");
    expect(svg.match(/class="vertex-label"/g)).toHaveLength(54);
    expect(svg).toContain(">A1<");
    for (const b of board.buildings) expect(svg).toContain(`data-location="${b.location}"`);
    expect(svg.match(/class="settlement"/g)).toHaveLength(3);
    expect(svg.match(/class="road"/g)).toHaveLength(3);
  });

  test("draws buildings in their team's colour and lists teams with points", async () => {
    const { game } = await startedGame({ seed: 42 });
    const board = (await game.board())!;
    const svg = renderMapSvg(board, { title: "Osada" });
    const start = board.buildings.find((b) => b.kind === "settlement" && b.teamId === 1)!;
    expect(svg).toMatch(new RegExp(`class="settlement" data-location="${start.location}"[^>]*fill="#d94f30"`));
    expect(svg).toContain("Engineering: 4 b.");
  });

  test("escapes team names", async () => {
    const { game } = await startedGame();
    const board = (await game.board())!;
    board.scoreboard[0]!.team.name = "<R&D>";
    expect(renderMapSvg(board, { title: "x" })).toContain("&#60;R&#38;D&#62;");
  });

  test("rasterises to a PNG", async () => {
    const { game } = await startedGame();
    const png = svgToPng(renderMapSvg((await game.board())!, { title: "Osada" }), 800);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(800);
  });
});

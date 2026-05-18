import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBullBoardAuth } from "../bull-board.controller";

function makeApp() {
  return { use: vi.fn() };
}

function makeResponse() {
  return {
    status: vi.fn(function (this: any) {
      return this;
    }),
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
}

beforeEach(() => {
  delete process.env.BULL_BOARD_USER;
  delete process.env.BULL_BOARD_PASS;
});

describe("FR-WORKER-001 — Bull Board auth gate", () => {
  it("blocks /admin/queues with 503 when credentials are missing", () => {
    const app = makeApp();
    const response = makeResponse();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    installBullBoardAuth(app as any);
    const [, handler] = app.use.mock.calls[0]!;
    handler({}, response);

    expect(app.use).toHaveBeenCalledWith("/admin/queues", expect.any(Function));
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith("Bull Board disabled: no auth configured.");
    warn.mockRestore();
  });

  it("mounts basic auth middleware when credentials are configured", () => {
    process.env.BULL_BOARD_USER = "ops";
    process.env.BULL_BOARD_PASS = "secret";
    const app = makeApp();

    installBullBoardAuth(app as any);

    expect(app.use).toHaveBeenCalledWith("/admin/queues", expect.any(Function));
    expect(app.use.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });
});

// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import awakeReducer from "./features/awake/awakeSlice";

const { invokeMock, isEnabledMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isEnabledMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: isEnabledMock,
}));

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    isEnabledMock.mockReset();
    isEnabledMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_start_on_ac_power") {
        return Promise.resolve(false);
      }
      if (command === "awake_status") {
        return Promise.resolve({
          isActive: false,
          isAcPowerConnected: false,
          awakeDuration: "forever",
          isLidClosed: false,
          batteryPercent: 80,
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("migrates a legacy enabled browser preference to the backend", async () => {
    window.localStorage.setItem("sleepless.startOnAcPower", "true");
    const store = configureStore({ reducer: { awake: awakeReducer } });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_start_on_ac_power", {
        enabled: true,
      });
    });
  });
});

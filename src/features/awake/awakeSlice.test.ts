import { describe, expect, it } from "vitest";
import awakeReducer, {
  awakeStatusReceived,
  awakeInitialState,
  startAwakeFailure,
  startAwakeRequest,
  startAwakeSuccess,
  stopAwakeFailure,
  stopAwakeRequest,
  stopAwakeSuccess,
  preferenceFailure,
  setAwakeDuration,
  tickRuntime,
  toggleStartOnAcPower,
  toggleLaunchAtLogin,
} from "./awakeSlice";

describe("awakeSlice", () => {
  it("starts inactive with no pending command", () => {
    expect(awakeReducer(undefined, { type: "unknown" })).toEqual({
      isActive: false,
      isBusy: false,
      isAcPowerConnected: null,
      awakeDuration: "forever",
      startOnAcPower: false,
      launchAtLogin: false,
      runtimeSeconds: 0,
      message: "AC power mode is ready.",
      error: null,
    });
  });

  it("marks the session active after start succeeds", () => {
    const pending = awakeReducer(awakeInitialState, startAwakeRequest());
    const active = awakeReducer(
      pending,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );

    expect(active).toMatchObject({
      isActive: true,
      isBusy: false,
      isAcPowerConnected: true,
      runtimeSeconds: 0,
      message: "Closed-lid awake mode is active while AC power is connected.",
      error: null,
    });
  });

  it("marks the session inactive after stop succeeds", () => {
    const active = awakeReducer(
      awakeInitialState,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );
    const pending = awakeReducer(active, stopAwakeRequest());
    const inactive = awakeReducer(pending, stopAwakeSuccess());

    expect(inactive).toMatchObject({
      isActive: false,
      isBusy: false,
      runtimeSeconds: 0,
      message: "Awake mode is off.",
      error: null,
    });
  });

  it("keeps the previous active state when a command fails", () => {
    const active = awakeReducer(
      awakeInitialState,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );

    expect(awakeReducer(active, stopAwakeFailure("Unable to stop"))).toMatchObject({
      isActive: true,
      isBusy: false,
      error: "Unable to stop",
    });

    expect(
      awakeReducer(awakeInitialState, startAwakeFailure("AC power is required")),
    ).toMatchObject({
      isActive: false,
      isBusy: false,
      error: "AC power is required",
    });
  });

  it("tracks runtime only while active", () => {
    const inactiveTick = awakeReducer(awakeInitialState, tickRuntime());
    const active = awakeReducer(
      awakeInitialState,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );
    const activeTick = awakeReducer(active, tickRuntime());

    expect(inactiveTick.runtimeSeconds).toBe(0);
    expect(activeTick.runtimeSeconds).toBe(1);
  });

  it("toggles launch at login preference", () => {
    const enabled = awakeReducer(awakeInitialState, toggleLaunchAtLogin());
    const disabled = awakeReducer(enabled, toggleLaunchAtLogin());

    expect(enabled.launchAtLogin).toBe(true);
    expect(disabled.launchAtLogin).toBe(false);
  });

  it("toggles AC power auto-start preference", () => {
    const enabled = awakeReducer(awakeInitialState, toggleStartOnAcPower());
    const disabled = awakeReducer(enabled, toggleStartOnAcPower());

    expect(enabled.startOnAcPower).toBe(true);
    expect(disabled.startOnAcPower).toBe(false);
  });

  it("sets the closed-lid awake duration", () => {
    const changed = awakeReducer(awakeInitialState, setAwakeDuration("30m"));

    expect(changed.awakeDuration).toBe("30m");
  });

  it("quietly marks the session off when AC power disconnects", () => {
    const active = awakeReducer(
      awakeInitialState,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );
    const disconnected = awakeReducer(
      active,
      awakeStatusReceived({
        isActive: false,
        isAcPowerConnected: false,
        awakeDuration: "forever",
        stoppedReason: "acDisconnected",
      }),
    );

    expect(disconnected).toMatchObject({
      isActive: false,
      isBusy: false,
      isAcPowerConnected: false,
      runtimeSeconds: 0,
      message: "AC power disconnected. Awake mode turned off.",
      error: null,
    });
  });

  it("marks the session off when the closed-lid duration ends", () => {
    const active = awakeReducer(
      awakeInitialState,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );
    const timedOut = awakeReducer(
      active,
      awakeStatusReceived({
        isActive: false,
        isAcPowerConnected: true,
        awakeDuration: "10m",
        stoppedReason: "durationExpired",
      }),
    );

    expect(timedOut).toMatchObject({
      isActive: false,
      awakeDuration: "10m",
      message: "Closed-lid duration ended. Awake mode turned off.",
      error: null,
    });
  });

  it("records preference errors without changing active state", () => {
    const active = awakeReducer(
      awakeInitialState,
      startAwakeSuccess({ isAcPowerConnected: true }),
    );
    const failed = awakeReducer(active, preferenceFailure("Preference failed"));

    expect(failed).toMatchObject({
      isActive: true,
      error: "Preference failed",
      message: "Preference could not change.",
    });
  });
});

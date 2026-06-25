import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type AwakeDuration = "10m" | "30m" | "1h" | "forever";
export type AwakeStoppedReason =
  | "acDisconnected"
  | "durationExpired"
  | "batteryLow"
  | "batteryUnsafe";

export interface AwakeState {
  isActive: boolean;
  isBusy: boolean;
  isAcPowerConnected: boolean | null;
  awakeDuration: AwakeDuration;
  startOnAcPower: boolean;
  launchAtLogin: boolean;
  runtimeSeconds: number;
  message: string;
  error: string | null;
}

export const awakeInitialState: AwakeState = {
  isActive: false,
  isBusy: false,
  isAcPowerConnected: null,
  awakeDuration: "forever",
  startOnAcPower: false,
  launchAtLogin: false,
  runtimeSeconds: 0,
  message: "AC power mode is ready.",
  error: null,
};

const awakeSlice = createSlice({
  name: "awake",
  initialState: awakeInitialState,
  reducers: {
    startAwakeRequest: (state) => {
      state.isBusy = true;
      state.error = null;
      state.message = "Starting closed-lid awake mode...";
    },
    startAwakeSuccess: (
      state,
      action: PayloadAction<{ isAcPowerConnected?: boolean } | undefined>,
    ) => {
      state.isActive = true;
      state.isBusy = false;
      state.isAcPowerConnected = action.payload?.isAcPowerConnected ?? true;
      state.runtimeSeconds = 0;
      state.error = null;
      state.message = "Closed-lid awake mode is active while AC power is connected.";
    },
    startAwakeFailure: (state, action: PayloadAction<string>) => {
      state.isBusy = false;
      state.error = action.payload;
      state.message = "Awake mode could not start.";
    },
    stopAwakeRequest: (state) => {
      state.isBusy = true;
      state.error = null;
      state.message = "Stopping awake mode...";
    },
    stopAwakeSuccess: (state) => {
      state.isActive = false;
      state.isBusy = false;
      state.runtimeSeconds = 0;
      state.error = null;
      state.message = "Awake mode is off.";
    },
    stopAwakeFailure: (state, action: PayloadAction<string>) => {
      state.isBusy = false;
      state.error = action.payload;
      state.message = "Awake mode could not stop.";
    },
    awakeStatusReceived: (
      state,
      action: PayloadAction<
        | boolean
        | {
            isActive: boolean;
            isAcPowerConnected?: boolean;
            awakeDuration?: AwakeDuration;
            stoppedReason?: AwakeStoppedReason;
          }
      >,
    ) => {
      const isActive =
        typeof action.payload === "boolean" ? action.payload : action.payload.isActive;
      state.isActive = isActive;
      state.isBusy = false;
      if (typeof action.payload !== "boolean") {
        state.isAcPowerConnected = action.payload.isAcPowerConnected ?? state.isAcPowerConnected;
        state.awakeDuration = action.payload.awakeDuration ?? state.awakeDuration;
      }
      if (!isActive) {
        state.runtimeSeconds = 0;
      }
      state.error = null;
      if (isActive) {
        state.message = "Closed-lid awake mode is active while AC power is connected.";
      } else if (
        typeof action.payload !== "boolean" &&
        action.payload.stoppedReason === "acDisconnected"
      ) {
        state.message = "AC power disconnected. Awake mode turned off.";
      } else if (
        typeof action.payload !== "boolean" &&
        action.payload.stoppedReason === "durationExpired"
      ) {
        state.message = "Closed-lid duration ended. Awake mode turned off.";
      } else if (
        typeof action.payload !== "boolean" &&
        action.payload.stoppedReason === "batteryLow"
      ) {
        state.message = "Battery reached 10%. Awake mode turned off.";
      } else if (
        typeof action.payload !== "boolean" &&
        action.payload.stoppedReason === "batteryUnsafe"
      ) {
        state.message = "Battery safety check stopped awake mode.";
      } else {
        state.message = "AC power mode is ready.";
      }
    },
    tickRuntime: (state) => {
      if (state.isActive) {
        state.runtimeSeconds += 1;
      }
    },
    toggleLaunchAtLogin: (state) => {
      state.launchAtLogin = !state.launchAtLogin;
    },
    toggleStartOnAcPower: (state) => {
      state.startOnAcPower = !state.startOnAcPower;
    },
    setStartOnAcPower: (state, action: PayloadAction<boolean>) => {
      state.startOnAcPower = action.payload;
    },
    setAwakeDuration: (state, action: PayloadAction<AwakeDuration>) => {
      state.awakeDuration = action.payload;
    },
    preferenceFailure: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.message = "Preference could not change.";
    },
  },
});

export const {
  awakeStatusReceived,
  preferenceFailure,
  setAwakeDuration,
  startAwakeFailure,
  startAwakeRequest,
  startAwakeSuccess,
  stopAwakeFailure,
  stopAwakeRequest,
  stopAwakeSuccess,
  setStartOnAcPower,
  tickRuntime,
  toggleLaunchAtLogin,
  toggleStartOnAcPower,
} = awakeSlice.actions;

export default awakeSlice.reducer;

import { configureStore } from "@reduxjs/toolkit";
import awakeReducer from "../features/awake/awakeSlice";

export const store = configureStore({
  reducer: {
    awake: awakeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

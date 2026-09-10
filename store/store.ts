import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import jobsReducer from './jobsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    jobs: jobsReducer,
    // Add more reducers here (e.g., chat)
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch; 
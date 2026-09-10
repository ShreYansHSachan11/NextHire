import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type Role = 'SEEKER' | 'COMPANY' | 'ADMIN';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId?: string;
  company?: { name: string };
  profile?: string;
  website?: string;
  industry?: string;
  size?: string;
  location?: string;
  description?: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
}

interface LoginPayload {
  user: AuthUser;
  token: string;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login(state, action: PayloadAction<LoginPayload>) {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
    },
    logout(state) {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
    },
    /**
     * Merges updated profile fields into the current user.
     *
     * Accepts an optional `token`: the API re-issues the JWT whenever a change
     * affects the name or company name, and without storing it here the stale
     * one keeps winning on the next rehydrate.
     */
    updateProfile(state, action: PayloadAction<Partial<AuthUser> & { token?: string | null }>) {
      const { token, ...fields } = action.payload;
      if (state.user) {
        state.user = { ...state.user, ...fields };
      }
      if (token) {
        state.token = token;
      }
    },
  },
});

export const { login, logout, updateProfile } = authSlice.actions;
export default authSlice.reducer;

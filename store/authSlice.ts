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
  isAuthenticated: boolean;
}

/**
 * `token` is accepted and deliberately dropped.
 *
 * The cookie is the only store of the JWT: every caller writes it there with
 * `setToken`, `authHeaders()` reads it back for every fetch, and
 * `AuthRehydrator` decodes it there on a hard navigation. Nothing ever read it
 * off this slice — so a second copy, in a store any component can select from
 * and the Redux devtools print in full, bought nothing and widened the surface
 * the JWT sits on. It stays in the payload because both callers do hold one;
 * this is simply where it stops.
 */
interface LoginPayload {
  user: AuthUser;
  token?: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login(state, action: PayloadAction<LoginPayload>) {
      state.user = action.payload.user;
      state.isAuthenticated = true;
    },
    logout(state) {
      state.user = null;
      state.isAuthenticated = false;
    },
    /**
     * Merges updated profile fields into the current user.
     *
     * The API re-issues the JWT whenever a change touches the name or company
     * name, and both edit pages hand that straight to `setToken` before
     * dispatching. `token` is still named in the payload so that spreading a
     * response object here cannot smuggle a JWT onto `AuthUser` as a stray
     * field — it is pulled out of `fields` and discarded, never stored.
     */
    updateProfile(state, action: PayloadAction<Partial<AuthUser> & { token?: string | null }>) {
      const { token: _token, ...fields } = action.payload;
      if (state.user) {
        state.user = { ...state.user, ...fields };
      }
    },
  },
});

export const { login, logout, updateProfile } = authSlice.actions;
export default authSlice.reducer;

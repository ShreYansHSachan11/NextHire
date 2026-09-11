import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * Match breakdown as returned by the API for a signed-in seeker.
 *
 * Declared here rather than imported from `lib/ai/matching`: that module pulls
 * in Prisma, which has no business in the client bundle.
 */
export interface JobMatch {
  score: number;
  facets: { semantic: number; skills: number; location: number; seniority: number };
  sharedSkills: string[];
  missingSkills: string[];
}

export interface Job {
  id: string;
  title: string;
  description: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
  companyId: string;
  company?: { id?: string; name: string; profile?: string | null };
  /** Skills parsed from the posting; rendered as chips and scored as one facet. */
  skills?: string[];
  /** Application count returned by the public feed. */
  _count?: { applications: number };
  /** Non-null only for a signed-in seeker whose profile has been indexed. */
  match?: JobMatch | null;
  /** 0-100 retrieval score, present only on results of a semantic `?q=` search. */
  relevance?: number | null;
  createdAt: string;
  isActive: boolean;
}

interface JobsState {
  jobs: Job[];
}

const initialState: JobsState = {
  jobs: [],
};

const jobsSlice = createSlice({
  name: 'jobs',
  initialState,
  reducers: {
    setJobs(state, action: PayloadAction<Job[]>) {
      state.jobs = action.payload;
    },
  },
});

export const { setJobs } = jobsSlice.actions;
export default jobsSlice.reducer;

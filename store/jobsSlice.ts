import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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
  /** Application count returned by the public feed. */
  _count?: { applications: number };
  createdAt: string;
  isActive: boolean;
}

interface JobsState {
  jobs: Job[];
  selectedJob: Job | null;
}

const initialState: JobsState = {
  jobs: [],
  selectedJob: null,
};

const jobsSlice = createSlice({
  name: 'jobs',
  initialState,
  reducers: {
    setJobs(state, action: PayloadAction<Job[]>) {
      state.jobs = action.payload;
    },
    selectJob(state, action: PayloadAction<Job | null>) {
      state.selectedJob = action.payload;
    },
  },
});

export const { setJobs, selectJob } = jobsSlice.actions;
export default jobsSlice.reducer;

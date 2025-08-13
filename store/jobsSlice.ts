import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Job {
  id: string;
  title: string;
  description: string;
  salary?: string;
  experience?: string;
  location?: string;
  type?: string;
  companyId: string;
  company?: {
    name: string;
  };
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
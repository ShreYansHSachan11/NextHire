"use client";

import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RootState } from "../../../store/store";


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
    id: string;
    name: string;
    profile?: string;
  };
  createdAt: string;
  isActive: boolean;
}

export default function JobDetailsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = React.use(params);
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [applicationMessage, setApplicationMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    fetchJob();
  }, [jobId]);

  const fetchJob = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/jobs/${jobId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          setError("Job not found");
        } else {
          throw new Error("Failed to fetch job");
        }
        return;
      }
      
      const jobData = await response.json();
      setJob(jobData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch job");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!isAuthenticated) {
      router.push("/auth/login");
      return;
    }

    if (user?.role !== "SEEKER") {
      setError("Only job seekers can apply for jobs");
      return;
    }

    try {
      setApplying(true);
      setError("");
      setSuccess("");

      const response = await fetch("/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: jobId,
          userId: user.id,
          message: applicationMessage || "I'm interested in this position"
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to apply for job");
      }

      setSuccess("Application submitted successfully!");
      setApplicationMessage("");
      
      // Redirect to dashboard after a short delay
      setTimeout(() => {
        router.push("/seeker/dashboard");
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply for job");
    } finally {
      setApplying(false);
    }
  };

  if (!hydrated) return null;

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            {/* Skeleton Loading */}
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-6"></div>
              
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 mb-8">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-6"></div>
                <div className="flex gap-4 mb-6">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-28"></div>
                </div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/6"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error && !job) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center transition-colors duration-300">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto text-center bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Oops! Something went wrong</h2>
            <p className="text-red-600 dark:text-red-400 mb-6">{error}</p>
            <Link 
              href="/jobs"
              className="inline-flex items-center bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Jobs
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center transition-colors duration-300">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto text-center bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.47-.881-6.08-2.33" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Job Not Found</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">The job you're looking for doesn't exist or has been removed.</p>
            <Link 
              href="/jobs"
              className="inline-flex items-center bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Browse All Jobs
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                Filling
              </Link>
              <Link href="/jobs" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                Jobs
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/jobs"
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Back to Jobs
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Back Button */}
          <Link 
            href="/jobs"
            className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mb-6 transition-colors group"
          >
            <svg className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="font-medium">Back to Jobs</span>
          </Link>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Job Header */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex-1">
                    <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white mb-3 leading-tight">
                      {job.title}
                    </h1>
                    <div className="flex items-center mb-4">
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mr-3">
                        <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-gray-800 dark:text-white">{job.company?.name}</h2>
                        <p className="text-gray-600 dark:text-gray-300">Company</p>
                      </div>
                    </div>
                  </div>
                  {job.isActive && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                      <span className="w-2 h-2 bg-green-400 rounded-full mr-2"></span>
                      Active
                    </span>
                  )}
                </div>

                {/* Job Tags */}
                <div className="flex flex-wrap gap-3 mb-6">
                  {job.location && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {job.location}
                    </span>
                  )}
                  {job.type && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2V6" />
                      </svg>
                      {job.type}
                    </span>
                  )}
                  {job.experience && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {job.experience} years
                    </span>
                  )}
                </div>

                {/* Salary Highlight */}
                {job.salary && (
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4 mb-6">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mr-3">
                        <span className="text-white text-sm">💰</span>
                      </div>
                      <div>
                        <p className="text-sm text-green-700 dark:text-green-300 font-medium">Salary</p>
                        <p className="text-lg font-bold text-green-800 dark:text-green-200">{job.salary}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Job Description */}
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Job Description</h3>
                  <div className="prose prose-gray dark:prose-invert max-w-none">
                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {job.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Apply Section */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 sticky top-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Apply for this position</h3>
                
                {!isAuthenticated ? (
                  <div className="space-y-4">
                    <p className="text-gray-600 dark:text-gray-300 text-sm">
                      Please log in to apply for this job.
                    </p>
                    <Link
                      href="/auth/login"
                      className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-center block"
                    >
                      Login to Apply
                    </Link>
                  </div>
                ) : user?.role !== "SEEKER" ? (
                  <div className="text-center">
                    <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">
                      Only job seekers can apply for jobs.
                    </p>
                    <Link
                      href="/seeker/dashboard"
                      className="w-full bg-gray-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-gray-700 transition-colors text-center block"
                    >
                      Go to Dashboard
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {error && (
                      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3">
                        <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                      </div>
                    )}
                    
                    {success && (
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3">
                        <p className="text-green-600 dark:text-green-400 text-sm">{success}</p>
                      </div>
                    )}

                    <div>
                      <label htmlFor="message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Cover Letter (Optional)
                      </label>
                      <textarea
                        id="message"
                        value={applicationMessage}
                        onChange={(e) => setApplicationMessage(e.target.value)}
                        placeholder="Tell us why you're interested in this position..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 resize-none"
                        rows={4}
                      />
                    </div>

                    <button
                      onClick={handleApply}
                      disabled={applying}
                      className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {applying ? (
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Applying...
                        </div>
                      ) : (
                        'Apply Now'
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Job Details */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Job Details</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Posted</span>
                    <span className="text-gray-900 dark:text-white font-medium">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {job.location && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-300">Location</span>
                      <span className="text-gray-900 dark:text-white font-medium">{job.location}</span>
                    </div>
                  )}
                  {job.type && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-300">Job Type</span>
                      <span className="text-gray-900 dark:text-white font-medium">{job.type}</span>
                    </div>
                  )}
                  {job.experience && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-300">Experience</span>
                      <span className="text-gray-900 dark:text-white font-medium">{job.experience} years</span>
                    </div>
                  )}
                  {job.salary && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-300">Salary</span>
                      <span className="text-gray-900 dark:text-white font-medium">{job.salary}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
} 
"use client";

import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RootState } from "../../../store/store";
import { logout } from "../../../store/authSlice";

interface Job {
  id: string;
  title: string;
  description: string;
  salary?: string;
  experience?: string;
  location?: string;
  type?: string;
  isActive: boolean;
  createdAt: string;
  applications: Application[];
}

interface Application {
  id: string;
  userId: string;
  status: string;
  message?: string;
  createdAt: string;
  user: {
    name: string;
    email: string;
  };
}

export default function CompanyDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const router = useRouter();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const dispatch = useDispatch();

  // Helper function to get token from cookies
  const getToken = () => {
    return document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
  };

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated && user?.companyId) {
      console.log('Company dashboard: Fetching jobs for companyId:', user.companyId);
      fetchJobs();
    } else {
      console.log('Company dashboard: Waiting for auth data:', { isAuthenticated, companyId: user?.companyId });
    }
  }, [isAuthenticated, user?.companyId]);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const token = getToken();
      console.log('Company dashboard: Fetching jobs with token:', token ? 'present' : 'missing');
      
      const response = await fetch(`/api/jobs?companyId=${user?.companyId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Company dashboard: Fetched jobs:', data.length);
        setJobs(data);
      } else {
        console.error("Failed to fetch jobs:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateApplicationStatus = async (applicationId: string, status: string) => {
    setUpdatingStatus(applicationId);
    try {
      const token = getToken();
      
      const response = await fetch(`/api/applications`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ 
          id: applicationId,
          status 
        }),
      });

      if (response.ok) {
        // Update the local state
        setJobs(prevJobs => 
          prevJobs.map(job => ({
            ...job,
            applications: job.applications.map(app => 
              app.id === applicationId ? { ...app, status } : app
            )
          }))
        );
      } else {
        const errorData = await response.json();
        console.error("Failed to update application status:", errorData);
        alert(`Failed to update status: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Error updating application status:", error);
      alert("Failed to update application status");
    } finally {
      setUpdatingStatus(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING": return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700";
      case "SHORTLISTED": return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-700";
      case "INTERVIEW": return "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-700";
      case "ACCEPTED": return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-700";
      case "REJECTED": return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-700";
      default: return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-600";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PENDING": return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
      case "SHORTLISTED": return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
      case "INTERVIEW": return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 6v6m-4-6h8m-8 6h8" />
        </svg>
      );
      case "ACCEPTED": return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
      case "REJECTED": return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
      default: return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
  };

  // Helper to format date
  function formatDate(dateStr?: string) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  }

  const handleEditProfile = () => {
    router.push("/company/profile/edit");
  };

  if (!hydrated) return null;

  if (!isAuthenticated) {
    router.push("/auth/login");
    return null;
  }

  // Show loading if user data is not yet available
  if (!user) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-300">Loading dashboard...</p>
          </div>
        </div>
      </main>
    );
  }

  // Debug: Log user data
  console.log('Company dashboard - User data:', user);
  console.log('Company dashboard - User name:', user.name);
  console.log('Company dashboard - Company object:', user.company);
  console.log('Company dashboard - Company name:', user.company?.name);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur shadow-lg border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-4 sm:py-6 gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Company Dashboard</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm sm:text-base">
                Welcome back, {user?.name}! 👋
                {user?.company?.name && (
                  <span className="block text-blue-600 dark:text-blue-400 font-medium">
                    {user.company.name}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center justify-center sm:justify-end space-x-2 sm:space-x-4">
              <button
                onClick={() => {
                  dispatch(logout());
                  document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
                  router.push("/");
                }}
                className="bg-red-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2 text-sm sm:text-base btn-touch"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2V6" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Total Jobs</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{jobs.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Active Jobs</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
                  {jobs.filter(job => job.isActive).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Total Applications</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
                  {jobs.reduce((total, job) => total + job.applications.length, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Pending Reviews</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
                  {jobs.reduce((total, job) => 
                    total + job.applications.filter(app => app.status === 'PENDING').length, 0
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <Link
            href="/jobs/post"
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 group"
          >
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition-colors">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Post New Job</h3>
                <p className="text-gray-600 dark:text-gray-300 text-xs sm:text-sm">Create a new job listing</p>
              </div>
            </div>
          </Link>

          <Link
            href="/applications"
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 group"
          >
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-green-100 dark:bg-green-900/30 rounded-lg group-hover:bg-green-200 dark:group-hover:bg-green-800/50 transition-colors">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">Applications</h3>
                <p className="text-gray-600 dark:text-gray-300 text-xs sm:text-sm">Review job applications</p>
              </div>
            </div>
          </Link>

          <Link
            href="/conversations"
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 group"
          >
            <div className="flex items-center">
              <div className="p-2 sm:p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-800/50 transition-colors">
                <svg className="w-4 h-4 sm:w-6 sm:h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div className="ml-3 sm:ml-4">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Messages</h3>
                <p className="text-gray-600 dark:text-gray-300 text-xs sm:text-sm">Chat with candidates</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Jobs Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-8">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">My Job Postings</h2>
            <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">Manage your active and inactive job listings</p>
          </div>
          
          {loading ? (
            <div className="p-6 sm:p-8 text-center">
              <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-300 text-sm sm:text-base">Loading your job postings...</p>
            </div>
          ) : jobs.length > 0 ? (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {jobs.map((job) => (
                <div key={job.id} className="p-4 sm:p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-1 line-clamp-2">{job.title}</h3>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-2">
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {job.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {job.type}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                        Posted on {formatDate(job.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 lg:ml-4 lg:flex-shrink-0">
                      <span className={`inline-flex items-center px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium border ${job.isActive ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-700' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-700'}`}>
                        <span className={`w-2 h-2 rounded-full mr-1 sm:mr-2 ${job.isActive ? 'bg-green-400' : 'bg-red-400'}`}></span>
                        {job.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <Link
                        href={`/jobs/${job.id}/edit`}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs sm:text-sm font-medium flex items-center gap-1 btn-touch"
                      >
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </Link>
                    </div>
                  </div>

                  {/* Applications for this job */}
                  {job.applications && job.applications.length > 0 && (
                    <div className="mt-4 sm:mt-6 bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4">
                      <h4 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Applications ({job.applications.length})
                      </h4>
                      <div className="space-y-3">
                        {job.applications.map((application) => (
                          <div key={application.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base">{application.user?.name || 'Unknown User'}</p>
                              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">{application.user?.email || 'No email'}</p>
                              {application.message && (
                                <div className="mt-1">
                                  <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded">
                                    <p className="whitespace-pre-wrap">"{application.message}"</p>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:ml-4 sm:flex-shrink-0">
                              <span className={`inline-flex items-center px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium border ${getStatusColor(application.status)}`}>
                                {getStatusIcon(application.status)}
                                <span className="ml-1">{application.status}</span>
                              </span>
                              <select
                                value={application.status}
                                onChange={(e) => updateApplicationStatus(application.id, e.target.value)}
                                disabled={updatingStatus === application.id}
                                className="text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 bg-white dark:bg-gray-700 text-gray-900 dark:text-white w-full sm:w-auto"
                              >
                                <option value="PENDING">Pending</option>
                                <option value="SHORTLISTED">Shortlisted</option>
                                <option value="INTERVIEW">Interview</option>
                                <option value="ACCEPTED">Accepted</option>
                                <option value="REJECTED">Rejected</option>
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 sm:p-8 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2V6" />
                </svg>
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">No Jobs Posted Yet</h3>
              <p className="text-gray-600 dark:text-gray-300 mb-4 text-sm sm:text-base">Start attracting talent by creating your first job listing.</p>
              <Link
                href="/jobs/post"
                className="inline-flex items-center bg-blue-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm sm:text-base btn-touch"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Post Your First Job
              </Link>
            </div>
          )}
        </div>

        {/* Company Profile Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Company Profile</h2>
            <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">Manage your company information</p>
          </div>
          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
              <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Name</label>
                <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base">{user?.name}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Address</label>
                <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base">{user?.email}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Type</label>
                <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base capitalize">{user?.role}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company ID</label>
                <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base">{user?.companyId}</p>
              </div>
              {user?.website && (
                <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Website</label>
                  <a 
                    href={user.website} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold text-sm sm:text-base break-all"
                  >
                    {user.website}
                  </a>
                </div>
              )}
              {user?.industry && (
                <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Industry</label>
                  <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base">{user.industry}</p>
                </div>
              )}
              {user?.size && (
                <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Size</label>
                  <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base">{user.size}</p>
                </div>
              )}
              {user?.location && (
                <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
                  <p className="text-gray-900 dark:text-white font-semibold text-sm sm:text-base">{user.location}</p>
                </div>
              )}
            </div>
            
            {/* Company Description */}
            {user?.description && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Company Description</label>
                <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                  <p className="text-gray-900 dark:text-white text-sm sm:text-base whitespace-pre-wrap">{user.description}</p>
                </div>
              </div>
            )}
            
            {/* Company Profile */}
            {user?.profile && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Company Profile</label>
                <div className="bg-gray-50 dark:bg-gray-700 p-3 sm:p-4 rounded-lg">
                  <p className="text-gray-900 dark:text-white text-sm sm:text-base whitespace-pre-wrap">{user.profile}</p>
                </div>
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row gap-3">
              <button 
                onClick={handleEditProfile}
                className="bg-blue-600 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 text-sm sm:text-base btn-touch"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="text-xs sm:text-sm">Edit Profile</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
} 
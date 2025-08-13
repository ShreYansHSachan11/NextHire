"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { setJobs } from "../../store/jobsSlice";
import type { RootState, AppDispatch } from "../../store/store";

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

export default function JobsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const jobList = useSelector((state: RootState) => state.jobs.jobs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({
    location: "",
    experience: "",
    type: "",
  });
  const { isAuthenticated, user } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/jobs");
      if (!response.ok) {
        throw new Error("Failed to fetch jobs");
      }
      const jobs = await response.json();
      dispatch(setJobs(jobs));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch jobs");
    } finally {
      setLoading(false);
    }
  };

  const filteredJobs = jobList.filter((job: Job) => {
    const matchesSearch = job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         job.company?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         job.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesLocation = !filters.location || job.location?.includes(filters.location);
    const matchesExperience = !filters.experience || job.experience?.includes(filters.experience);
    const matchesType = !filters.type || job.type?.includes(filters.type);

    return matchesSearch && matchesLocation && matchesExperience && matchesType;
  });

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white transition-colors duration-300">
        <div className="container-responsive py-6 sm:py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-300 text-lg">Loading jobs...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white transition-colors duration-300">
        <div className="container-responsive py-6 sm:py-8">
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400 mb-4 text-lg">{error}</p>
            <button 
              onClick={fetchJobs}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors btn-touch"
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white transition-colors duration-300">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container-responsive py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
                Filling
              </Link>
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Job Feed</h1>
            </div>
            <div className="flex items-center space-x-4">
              {!isAuthenticated ? (
                <Link href="/auth/login" className="text-gray-600 hover:text-blue-600 transition-colors">
                  Login
                </Link>
              ) : (
                <Link
                  href={user?.role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard"}
                  className="text-gray-600 hover:text-blue-600 transition-colors"
                >
                  Profile
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container-responsive py-6 sm:py-8">
        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-xl shadow-lg mb-6 sm:mb-8 border border-gray-200 dark:border-gray-700">
          {/* Search Bar */}
          <div className="mb-4 sm:mb-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search jobs, companies, skills..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>
          </div>
          
          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <select 
              value={filters.location}
              onChange={(e) => setFilters({...filters, location: e.target.value})}
              className="px-3 sm:px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white text-sm"
            >
              <option value="">All Locations</option>
              <option value="Bangalore">Bangalore</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Remote">Remote</option>
            </select>
            <select 
              value={filters.experience}
              onChange={(e) => setFilters({...filters, experience: e.target.value})}
              className="px-3 sm:px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white text-sm"
            >
              <option value="">All Experience</option>
              <option value="0-1">0-1 years</option>
              <option value="1-3">1-3 years</option>
              <option value="3-6">3-6 years</option>
            </select>
            <select 
              value={filters.type}
              onChange={(e) => setFilters({...filters, type: e.target.value})}
              className="px-3 sm:px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white text-sm sm:col-span-2 lg:col-span-1"
            >
              <option value="">All Types</option>
              <option value="Full Time">Full Time</option>
              <option value="Remote">Remote</option>
              <option value="Internship">Internship</option>
            </select>
          </div>
        </div>

        {/* Results count */}
        <div className="mb-4 sm:mb-6 text-gray-600 dark:text-gray-300 text-sm sm:text-base">
          <span className="font-medium text-gray-900 dark:text-white">{filteredJobs.length}</span> job{filteredJobs.length !== 1 ? 's' : ''} found
          {(searchTerm || filters.location || filters.experience || filters.type) && (
            <span className="text-gray-400 dark:text-gray-500 ml-2">
              (filtered results)
            </span>
          )}
        </div>

        {/* Job Cards */}
        <div className="grid gap-4 sm:gap-6 lg:gap-8 grid-cols-1 lg:grid-cols-2">
          {filteredJobs.map((job: Job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:border-blue-300 dark:hover:border-blue-600 hover:scale-[1.02] relative overflow-hidden"
            >
              {/* Gradient overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-50/0 to-purple-50/0 group-hover:from-blue-50/30 group-hover:to-purple-50/30 dark:group-hover:from-blue-900/10 dark:group-hover:to-purple-900/10 transition-all duration-300 pointer-events-none"></div>
              
              {/* Header with company logo placeholder */}
              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg">
                    {job.company?.name?.charAt(0) || 'C'}
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                      {job.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base font-medium">
                      {job.company?.name || 'Company Name'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end space-y-1">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    job.isActive 
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700' 
                      : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700'
                  }`}>
                    <span className={`w-2 h-2 rounded-full mr-1 ${job.isActive ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    {job.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* Job details */}
              <div className="space-y-3 relative z-10">
                <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base line-clamp-3">
                  {job.description}
                </p>
                
                <div className="flex flex-wrap gap-2 sm:gap-3">
                  {job.location && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {job.location}
                    </span>
                  )}
                  {job.type && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {job.type}
                    </span>
                  )}
                  {job.experience && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2V6" />
                      </svg>
                      {job.experience} years
                    </span>
                  )}
                  {job.salary && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                      </svg>
                      {job.salary}
                    </span>
                  )}
                </div>

                {/* Posted date */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Posted {new Date(job.createdAt).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </p>
                  <div className="flex items-center text-blue-600 dark:text-blue-400 text-sm font-medium group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                    View Details
                    <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* No results */}
        {filteredJobs.length === 0 && (
          <div className="text-center py-12 sm:py-16">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2V6" />
              </svg>
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2 sm:mb-3">No jobs found</h3>
            <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base mb-6 sm:mb-8 max-w-md mx-auto">
              {searchTerm || filters.location || filters.experience || filters.type 
                ? "Try adjusting your search criteria or filters to find more jobs."
                : "We're currently updating our job listings. Check back soon for new opportunities!"
              }
            </p>
            {(searchTerm || filters.location || filters.experience || filters.type) && (
              <button
                onClick={() => {
                  setSearchTerm("");
                  setFilters({ location: "", experience: "", type: "" });
                }}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium btn-touch"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
} 
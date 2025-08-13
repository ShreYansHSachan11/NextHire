"use client";

import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RootState } from "../../store/store";

interface Application {
  id: string;
  status: string;
  message?: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    resumes: {
      id: string;
      url: string;
      createdAt: string;
    }[];
  };
  job: {
    id: string;
    title: string;
    company: {
      name: string;
    };
  };
}

export default function ApplicationsPage() {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "",
    jobId: "",
    hasResume: ""
  });
  const [jobs, setJobs] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "COMPANY") {
      router.push("/auth/login");
      return;
    }

    if (user?.companyId) {
      fetchApplications();
      fetchJobs();
    }
  }, [isAuthenticated, user?.companyId, router]);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/applications?companyId=${user?.companyId}`);
      
      if (response.ok) {
        const data = await response.json();
        setApplications(data);
      } else {
        console.error("Failed to fetch applications:", response.status);
      }
    } catch (error) {
      console.error("Failed to fetch applications:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const response = await fetch(`/api/jobs?companyId=${user?.companyId}`);
      if (response.ok) {
        const data = await response.json();
        setJobs(data);
      }
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    }
  };

  const updateApplicationStatus = async (applicationId: string, status: string) => {
    try {
      console.log('Updating application status:', applicationId, 'to', status);
      setUpdatingStatus(applicationId);
      
      // Get token from cookies
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('token='))
        ?.split('=')[1];
      
      const response = await fetch("/api/applications", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          id: applicationId,
          status,
        }),
      });

      if (response.ok) {
        console.log('Application status updated successfully');
        fetchApplications(); // Refresh data
      } else {
        const errorData = await response.json();
        console.error("Failed to update application status:", errorData);
        alert(`Failed to update status: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Failed to update application status:", error);
      alert('Failed to update application status. Please try again.');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const startConversation = async (userId: string, userName: string) => {
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          companyId: user?.companyId,
        }),
      });

      if (response.ok) {
        const conversation = await response.json();
        // Navigate to conversations page with the conversation ID
        router.push(`/conversations?conversationId=${conversation.id}`);
      } else {
        console.error("Failed to start conversation");
        alert('Failed to start conversation. Please try again.');
      }
    } catch (error) {
      console.error("Failed to start conversation:", error);
      alert('Failed to start conversation. Please try again.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING": return "bg-yellow-100 text-yellow-800";
      case "SHORTLISTED": return "bg-blue-100 text-blue-800";
      case "INTERVIEW": return "bg-purple-100 text-purple-800";
      case "ACCEPTED": return "bg-green-100 text-green-800";
      case "REJECTED": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const filteredApplications = applications.filter(app => {
    const matchesStatus = !filters.status || app.status === filters.status;
    const matchesJob = !filters.jobId || app.job.id === filters.jobId;
    const matchesResume = !filters.hasResume || 
      (filters.hasResume === 'yes' && app.user.resumes && app.user.resumes.length > 0) ||
      (filters.hasResume === 'no' && (!app.user.resumes || app.user.resumes.length === 0));
    return matchesStatus && matchesJob && matchesResume;
  });

  const getStatusCounts = () => {
    const counts = {
      PENDING: 0,
      SHORTLISTED: 0,
      INTERVIEW: 0,
      ACCEPTED: 0,
      REJECTED: 0
    };
    
    applications.forEach(app => {
      if (counts[app.status as keyof typeof counts] !== undefined) {
        counts[app.status as keyof typeof counts]++;
      }
    });
    
    return counts;
  };

  const statusCounts = getStatusCounts();

  if (!isAuthenticated || user?.role !== "COMPANY") {
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Job Applications</h1>
              <p className="text-gray-600">Manage all applications for your job postings</p>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/company/dashboard"
                className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-yellow-600">{statusCounts.PENDING}</div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-blue-600">{statusCounts.SHORTLISTED}</div>
            <div className="text-sm text-gray-600">Shortlisted</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-purple-600">{statusCounts.INTERVIEW}</div>
            <div className="text-sm text-gray-600">Interview</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-green-600">{statusCounts.ACCEPTED}</div>
            <div className="text-sm text-gray-600">Accepted</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-red-600">{statusCounts.REJECTED}</div>
            <div className="text-sm text-gray-600">Rejected</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-6 rounded-lg shadow-sm border mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="SHORTLISTED">Shortlisted</option>
                <option value="INTERVIEW">Interview</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Job</label>
              <select
                value={filters.jobId}
                onChange={(e) => setFilters({...filters, jobId: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">All Jobs</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>{job.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Resume</label>
              <select
                value={filters.hasResume}
                onChange={(e) => setFilters({...filters, hasResume: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">All Applications</option>
                <option value="yes">With Resume</option>
                <option value="no">Without Resume</option>
              </select>
            </div>
          </div>
        </div>

        {/* Applications List */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Applications ({filteredApplications.length})
            </h2>
          </div>
          
          {loading ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading applications...</p>
            </div>
          ) : filteredApplications.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {filteredApplications.map((application) => (
                <div key={application.id} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-medium text-gray-900">
                          {application.user.name}
                        </h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(application.status)}`}>
                          {application.status}
                        </span>
                      </div>
                      
                      <div className="text-sm text-gray-600 mb-2">
                        <p><strong>Email:</strong> {application.user.email}</p>
                        <p><strong>Job:</strong> {application.job.title}</p>
                        <p><strong>Applied:</strong> {new Date(application.createdAt).toLocaleDateString()}</p>
                        {application.user.resumes && application.user.resumes.length > 0 && (
                          <div className="mt-2">
                            <p className="text-green-600 font-medium">📄 Resume Available</p>
                            <p className="text-xs text-gray-500">
                              Uploaded: {new Date(application.user.resumes[0].createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {application.message && (
                        <div className="mt-3 p-3 bg-gray-50 rounded">
                          <p className="text-sm text-gray-700">
                            <strong>Message:</strong> {application.message}
                          </p>
                        </div>
                      )}
                    </div>
                    
                    <div className="ml-6 flex flex-col space-y-2">
                      <select
                        value={application.status}
                        onChange={(e) => updateApplicationStatus(application.id, e.target.value)}
                        disabled={updatingStatus === application.id}
                        className="text-sm border border-gray-300 rounded px-3 py-2 hover:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                      >
                        <option value="PENDING">Pending</option>
                        <option value="SHORTLISTED">Shortlisted</option>
                        <option value="INTERVIEW">Interview</option>
                        <option value="ACCEPTED">Accepted</option>
                        <option value="REJECTED">Rejected</option>
                      </select>
                      
                      {updatingStatus === application.id && (
                        <div className="text-xs text-gray-500">Updating...</div>
                      )}
                      
                      {application.user.resumes && application.user.resumes.length > 0 && (
                        <div className="flex flex-col space-y-1">
                          <button
                            onClick={() => window.open(application.user.resumes[0].url, '_blank')}
                            className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition"
                          >
                            📄 View Resume
                          </button>
                          <button
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = application.user.resumes[0].url;
                              link.download = `${application.user.name}_resume.pdf`;
                              link.click();
                            }}
                            className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition"
                          >
                            ⬇️ Download
                          </button>
                        </div>
                      )}
                      
                      <button
                        onClick={() => startConversation(application.user.id, application.user.name)}
                        className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 transition"
                      >
                        💬 Message
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center">
              <p className="text-gray-500">
                {applications.length === 0 
                  ? "No applications received yet." 
                  : "No applications match your current filters."}
              </p>
              {applications.length === 0 && (
                <Link
                  href="/jobs/post"
                  className="mt-4 inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                >
                  Post a Job
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
} 
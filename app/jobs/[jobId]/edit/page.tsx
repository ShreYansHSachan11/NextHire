"use client";

import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RootState } from "../../../../store/store";

interface Job {
  id: string;
  title: string;
  description: string;
  salary?: string;
  experience?: string;
  location?: string;
  type?: string;
  companyId: string;
  isActive: boolean;
  createdAt: string;
}

export default function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = React.use(params);
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const [job, setJob] = useState<Job | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    salary: "",
    experience: "",
    location: "",
    type: "",
    isActive: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "COMPANY") {
      router.push("/auth/login");
      return;
    }
    fetchJob();
  }, [jobId, isAuthenticated, user?.role, router]);

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
      
      // Check if the job belongs to the current user's company
      if (jobData.companyId !== user?.companyId) {
        setError("You can only edit jobs from your company");
        return;
      }
      
      setJob(jobData);
      setFormData({
        title: jobData.title,
        description: jobData.description,
        salary: jobData.salary || "",
        experience: jobData.experience || "",
        location: jobData.location || "",
        type: jobData.type || "",
        isActive: jobData.isActive
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch job");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update job");
      }

      setSuccess("Job updated successfully!");
      setTimeout(() => router.push("/company/dashboard"), 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update job");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this job? This action cannot be undone.")) {
      return;
    }

    try {
      setSaving(true);
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete job");
      }

      setSuccess("Job deleted successfully!");
      setTimeout(() => router.push("/company/dashboard"), 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete job");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading job details...</p>
        </div>
      </main>
    );
  }

  if (error && !job) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link 
            href="/company/dashboard"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Job not found</p>
          <Link 
            href="/company/dashboard"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link 
              href="/company/dashboard"
              className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-2"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Edit Job</h1>
          </div>
          <button
            onClick={handleDelete}
            disabled={saving}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? "Deleting..." : "Delete Job"}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
        
        {success && (
          <div className="mb-6 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
            {success}
          </div>
        )}

        {/* Edit Form */}
        <div className="bg-white rounded-lg shadow-md p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Job Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Job Description *</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                required
                rows={6}
                className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Salary (optional)</label>
                <input
                  type="text"
                  name="salary"
                  value={formData.salary}
                  onChange={handleChange}
                  placeholder="e.g. $80,000 - $120,000"
                  className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Experience (optional)</label>
                <input
                  type="text"
                  name="experience"
                  value={formData.experience}
                  onChange={handleChange}
                  placeholder="e.g. 3-5 years"
                  className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Location (optional)</label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="e.g. Remote, New York, NY"
                  className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Job Type *</label>
                <select
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select Job Type</option>
                  <option value="Full Time">Full Time</option>
                  <option value="Part Time">Part Time</option>
                  <option value="Internship">Internship</option>
                  <option value="Contract">Contract</option>
                </select>
              </div>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label className="ml-2 block text-sm text-gray-900">
                Job is active and accepting applications
              </label>
            </div>

            <div className="flex gap-4 pt-6">
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white py-2 px-6 rounded hover:bg-blue-700 transition font-semibold disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              
              <Link 
                href="/company/dashboard"
                className="bg-gray-200 text-gray-700 py-2 px-6 rounded hover:bg-gray-300 transition font-semibold"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
} 
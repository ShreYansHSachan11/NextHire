"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store/store";

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur shadow-lg border-b border-gray-200 sticky top-0 z-30 transition-all">
        <div className="container-responsive">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-blue-700 tracking-tight drop-shadow-sm">Filling</h1>
              </div>
            </div>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-4 lg:space-x-6">
              <a href="#features" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm lg:text-base font-medium transition-colors">Features</a>
              <a href="#how-it-works" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm lg:text-base font-medium transition-colors">How it Works</a>
              <a href="#testimonials" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm lg:text-base font-medium transition-colors">Testimonials</a>
              {!isAuthenticated ? (
                <>
                  <Link href="/auth/login" className="bg-blue-600 text-white px-4 lg:px-5 py-2 rounded-lg text-sm lg:text-base font-semibold shadow hover:bg-blue-700 transition btn-touch">Login</Link>
                  <Link href="/auth/register" className="bg-green-600 text-white px-4 lg:px-5 py-2 rounded-lg text-sm lg:text-base font-semibold shadow hover:bg-green-700 transition btn-touch">Sign Up</Link>
                </>
              ) : (
                <Link
                  href={user?.role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard"}
                  className="bg-blue-700 text-white px-4 lg:px-5 py-2 rounded-lg text-sm lg:text-base font-semibold shadow hover:bg-blue-800 transition btn-touch"
                >
                  Profile
                </Link>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center space-x-2">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="text-gray-700 hover:text-blue-600 focus:outline-none focus:text-blue-600 btn-touch"
                aria-label="Open menu"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {isMenuOpen && (
            <div className="md:hidden animate-fade-in-down">
              <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 border-t border-gray-200 mt-4">
                <a 
                  href="#features" 
                  onClick={() => setIsMenuOpen(false)}
                  className="text-gray-700 hover:text-blue-600 block px-3 py-3 rounded-md text-base font-medium transition-colors"
                >
                  Features
                </a>
                <a 
                  href="#how-it-works" 
                  onClick={() => setIsMenuOpen(false)}
                  className="text-gray-700 hover:text-blue-600 block px-3 py-3 rounded-md text-base font-medium transition-colors"
                >
                  How it Works
                </a>
                <a 
                  href="#testimonials" 
                  onClick={() => setIsMenuOpen(false)}
                  className="text-gray-700 hover:text-blue-600 block px-3 py-3 rounded-md text-base font-medium transition-colors"
                >
                  Testimonials
                </a>
                <div className="pt-2 space-y-2">
                  {!isAuthenticated ? (
                    <>
                      <Link 
                        href="/auth/login" 
                        onClick={() => setIsMenuOpen(false)}
                        className="bg-blue-600 text-white block px-3 py-3 rounded-md text-base font-semibold shadow hover:bg-blue-700 transition btn-touch"
                      >
                        Login
                      </Link>
                      <Link 
                        href="/auth/register" 
                        onClick={() => setIsMenuOpen(false)}
                        className="bg-green-600 text-white block px-3 py-3 rounded-md text-base font-semibold shadow hover:bg-green-700 transition btn-touch"
                      >
                        Sign Up
                      </Link>
                    </>
                  ) : (
                    <Link
                      href={user?.role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard"}
                      onClick={() => setIsMenuOpen(false)}
                      className="bg-blue-700 text-white block px-3 py-3 rounded-md text-base font-semibold shadow hover:bg-blue-800 transition btn-touch"
                    >
                      Profile
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-blue-100 via-indigo-100 to-white py-16 sm:py-20 lg:py-28 overflow-hidden transition-colors duration-300">
        <div className="absolute inset-0 pointer-events-none select-none">
          <svg 
            className="absolute bottom-0 left-0 w-full h-32 sm:h-40 opacity-100" 
            viewBox="0 0 1440 320" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
          >
            <path 
              fill="#6366F1" 
              fillOpacity="0.1" 
              d="M0,224L48,202.7C96,181,192,139,288,144C384,149,480,203,576,197.3C672,192,768,128,864,128C960,128,1056,192,1152,197.3C1248,203,1344,149,1392,122.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>
        <div className="container-responsive relative z-10">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-gray-900 mb-6 sm:mb-8 leading-tight drop-shadow-sm animate-fade-in-up">
              Find Your Dream Job with
              <span className="text-blue-600"> Filling</span>
            </h1>
            <p className="text-lg sm:text-xl lg:text-2xl text-gray-700 mb-8 sm:mb-10 max-w-3xl mx-auto animate-fade-in-up delay-100 px-4">
              Connect talented professionals with amazing opportunities. Whether you're looking for your next career move or seeking the perfect team member, we've got you covered.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center animate-fade-in-up delay-200 px-4">
              <Link 
                href="/jobs" 
                className="bg-blue-600 text-white px-12 sm:px-16 lg:px-20 py-6 sm:py-8 rounded-2xl text-2xl sm:text-3xl font-bold shadow-xl hover:bg-blue-700 hover:shadow-2xl transition-all duration-300 btn-touch min-w-[200px]"
              >
                Browse Jobs
              </Link>
              <Link 
                href="/auth/register" 
                className="bg-green-600 text-white px-12 sm:px-16 lg:px-20 py-6 sm:py-8 rounded-2xl text-2xl sm:text-3xl font-bold shadow-xl hover:bg-green-700 hover:shadow-2xl transition-all duration-300 btn-touch min-w-[200px]"
              >
                Post a Job
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 sm:py-16 bg-white transition-colors duration-300">
        <div className="container-responsive">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8 text-center">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 sm:p-6 rounded-xl shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-blue-600 mb-2">10,000+</div>
              <div className="text-sm sm:text-base text-gray-600">Active Jobs</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 sm:p-6 rounded-xl shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-green-600 mb-2">50,000+</div>
              <div className="text-sm sm:text-base text-gray-600">Job Seekers</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 sm:p-6 rounded-xl shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-purple-600 mb-2">5,000+</div>
              <div className="text-sm sm:text-base text-gray-600">Companies</div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 sm:p-6 rounded-xl shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-orange-600 mb-2">95%</div>
              <div className="text-sm sm:text-base text-gray-600">Success Rate</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 sm:py-20 bg-gray-50 transition-colors duration-300">
        <div className="container-responsive">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Why Choose Filling?
            </h2>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto px-4">
              We provide the tools and platform you need to succeed in your career journey.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2V6" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4">Smart Job Matching</h3>
              <p className="text-gray-600 text-sm sm:text-base">
                Our AI-powered algorithm matches you with the perfect job opportunities based on your skills, experience, and preferences.
              </p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4">Easy Application Process</h3>
              <p className="text-gray-600 text-sm sm:text-base">
                Apply to multiple jobs with just a few clicks. Save your resume and cover letter templates for quick applications.
              </p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 md:col-span-2 lg:col-span-1">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4">Direct Communication</h3>
              <p className="text-gray-600 text-sm sm:text-base">
                Chat directly with employers and candidates. No more waiting for email responses - get instant feedback.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-16 sm:py-20 bg-white transition-colors duration-300">
        <div className="container-responsive">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              How It Works
            </h2>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto px-4">
              Get started in just a few simple steps
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            <div className="text-center group">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                <span className="text-2xl font-bold text-blue-600">1</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Create Account</h3>
              <p className="text-gray-600 text-sm sm:text-base">Sign up as a job seeker or employer in minutes</p>
            </div>

            <div className="text-center group">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                <span className="text-2xl font-bold text-green-600">2</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Complete Profile</h3>
              <p className="text-gray-600 text-sm sm:text-base">Add your skills, experience, and preferences</p>
            </div>

            <div className="text-center group">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                <span className="text-2xl font-bold text-purple-600">3</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Find Opportunities</h3>
              <p className="text-gray-600 text-sm sm:text-base">Browse jobs or post openings that match your needs</p>
            </div>

            <div className="text-center group">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                <span className="text-2xl font-bold text-orange-600">4</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect & Apply</h3>
              <p className="text-gray-600 text-sm sm:text-base">Apply for jobs or hire the perfect candidate</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-16 sm:py-20 bg-gray-50 transition-colors duration-300">
        <div className="container-responsive">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              What Our Users Say
            </h2>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto px-4">
              Don't just take our word for it - hear from our community
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                  <span className="text-blue-600 font-semibold">JS</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">John Smith</h4>
                  <p className="text-gray-600 text-sm">Software Developer</p>
                </div>
              </div>
              <p className="text-gray-600 text-sm sm:text-base">
                 "Filling helped me find my dream job in just 2 weeks! The matching algorithm is incredible."
               </p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mr-4">
                  <span className="text-green-600 font-semibold">SJ</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">Sarah Johnson</h4>
                  <p className="text-gray-600 text-sm">HR Manager</p>
                </div>
              </div>
              <p className="text-gray-600 text-sm sm:text-base">
                "We've hired 15 amazing developers through Filling. The quality of candidates is outstanding."
              </p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 md:col-span-2 lg:col-span-1">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                  <span className="text-purple-600 font-semibold">MJ</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">Mike Chen</h4>
                  <p className="text-gray-600 text-sm">Product Manager</p>
                </div>
              </div>
              <p className="text-gray-600 text-sm sm:text-base">
                "The direct messaging feature saved us weeks of back-and-forth emails. Highly recommended!"
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-20 bg-blue-600 transition-colors duration-300">
        <div className="container-responsive">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to Get Started?
          </h2>
            <p className="text-lg sm:text-xl text-blue-100 mb-8 max-w-2xl mx-auto px-4">
              Join thousands of professionals who have found their dream jobs through Filling
           </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/auth/register" 
                className="bg-white text-blue-600 px-8 py-4 rounded-xl text-lg font-bold shadow-lg hover:bg-gray-100 transition-all duration-300 btn-touch"
              >
                Get Started Today
            </Link>
              <Link 
                href="/jobs" 
                className="bg-transparent text-white border-2 border-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-white hover:text-blue-600 transition-all duration-300 btn-touch"
              >
              Browse Jobs
            </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 sm:py-16 transition-colors duration-300">
        <div className="container-responsive">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
                             <h3 className="text-2xl font-bold text-blue-400 mb-4">Filling</h3>
              <p className="text-gray-300 text-sm sm:text-base mb-6 max-w-md">
                Connecting talented professionals with amazing opportunities. Your career journey starts here.
              </p>
              <div className="flex space-x-4">
                <a href="#" className="text-gray-400 hover:text-blue-400 transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                  </svg>
                </a>
                <a href="#" className="text-gray-400 hover:text-blue-400 transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                  </svg>
                </a>
                <a href="#" className="text-gray-400 hover:text-blue-400 transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
              </div>
            </div>
            
            <div>
              <h4 className="text-lg font-semibold mb-4">For Job Seekers</h4>
              <ul className="space-y-2 text-sm sm:text-base">
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Browse Jobs</a></li>
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Create Profile</a></li>
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Resume Builder</a></li>
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Career Advice</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-lg font-semibold mb-4">For Employers</h4>
              <ul className="space-y-2 text-sm sm:text-base">
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Post a Job</a></li>
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Browse Candidates</a></li>
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Pricing</a></li>
                <li><a href="#" className="text-gray-300 hover:text-blue-400 transition-colors">Support</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-400 text-sm">
              © 2024 Filling. All rights reserved. Made with ❤️ for job seekers and employers.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { createApi } from '@reduxjs/toolkit/query/react';
import { http } from './http.js';

/** RTK Query base query that performs the request with axios. Errors are already normalised by the interceptor. */
const axiosBaseQuery = () => async ({ url, method = 'GET', data, params }) => {
  try {
    const res = await http({ url, method, data, params });
    return { data: res.data };
  } catch (error) {
    return { error };
  }
};

// Any write can change counts, health and the dashboard, so writes refresh all cached reads.
const ALL = ['Task', 'Project', 'Dashboard', 'User'];
const write = (builder, query) => builder.mutation({ query, invalidatesTags: ALL });

export const api = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery(),
  tagTypes: ALL,
  endpoints: (b) => ({
    // ----- reads -----
    getDashboard: b.query({ query: () => ({ url: '/dashboard' }), providesTags: ['Dashboard'] }),
    getProjects: b.query({ query: () => ({ url: '/projects' }), providesTags: ['Project'] }),
    getProject: b.query({ query: (id) => ({ url: `/projects/${id}` }), providesTags: ['Project'] }),
    getTasks: b.query({ query: (params) => ({ url: '/tasks', params }), providesTags: ['Task'] }),
    getTask: b.query({ query: (id) => ({ url: `/tasks/${id}` }), providesTags: ['Task'] }),
    getUsers: b.query({ query: () => ({ url: '/users' }), providesTags: ['User'] }),

    // ----- projects -----
    createProject: write(b, (data) => ({ url: '/projects', method: 'POST', data })),
    updateProject: write(b, ({ id, ...data }) => ({ url: `/projects/${id}`, method: 'PATCH', data })),
    setMembers: write(b, ({ id, memberIds }) => ({ url: `/projects/${id}/members`, method: 'PUT', data: { memberIds } })),
    deleteProject: write(b, (id) => ({ url: `/projects/${id}`, method: 'DELETE' })),

    // ----- tasks -----
    createTask: write(b, ({ projectId, ...data }) => ({ url: `/projects/${projectId}/tasks`, method: 'POST', data })),
    updateTask: write(b, ({ id, ...data }) => ({ url: `/tasks/${id}`, method: 'PATCH', data })),
    transitionTask: write(b, ({ id, ...data }) => ({ url: `/tasks/${id}/transition`, method: 'POST', data })),
    reportProgress: write(b, ({ id, ...data }) => ({ url: `/tasks/${id}/progress`, method: 'POST', data })),
    postUpdate: write(b, ({ id, ...data }) => ({ url: `/tasks/${id}/updates`, method: 'POST', data })),
    blockTask: write(b, ({ id, ...data }) => ({ url: `/tasks/${id}/block`, method: 'POST', data })),

    // ----- users -----
    createUser: write(b, (data) => ({ url: '/users', method: 'POST', data })),
    updateUser: write(b, ({ id, ...data }) => ({ url: `/users/${id}`, method: 'PATCH', data })),
  }),
});

export const {
  useGetDashboardQuery, useGetProjectsQuery, useGetProjectQuery, useGetTasksQuery, useGetTaskQuery, useGetUsersQuery,
  useCreateProjectMutation, useUpdateProjectMutation, useSetMembersMutation, useDeleteProjectMutation,
  useCreateTaskMutation, useUpdateTaskMutation, useTransitionTaskMutation, useReportProgressMutation,
  usePostUpdateMutation, useBlockTaskMutation, useCreateUserMutation, useUpdateUserMutation,
} = api;

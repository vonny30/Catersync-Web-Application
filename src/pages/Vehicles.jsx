// pages/Vehicles.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, X, Truck, Car, Settings, Calendar, MapPin, Users, Clock, RefreshCw, Undo2 } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function Vehicles() {
  const { showConfirm } = useConfirm();
  // --- DATA STATE ---
  const [vehicles, setVehicles] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- MODAL STATES ---
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isManageFleetModalOpen, setIsManageFleetModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // --- FORM STATES ---
  const [newVehicleForm, setNewVehicleForm] = useState({
    plate_number: '',
    vehicle_type: 'Car',
    vehicle_status: 'Available',
  });

  const [editVehicleForm, setEditVehicleForm] = useState({
    vehicle_id: '',
    plate_number: '',
    vehicle_type: 'Car',
    vehicle_status: 'Available',
  });

  const [assignForm, setAssignForm] = useState({
    booking_id: '',
    dispatch_datetime: '',
    assignment_status: 'Scheduled',
  });

  // --- MULTIPLE VEHICLE SELECTION ---
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);

  // --- Helper: Log technical error and show user-friendly toast ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- FETCH VEHICLES, ASSIGNMENTS, BOOKINGS ---
  const fetchVehicles = async () => {
    setIsLoading(true);
    try {
      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicle')
        .select('*')
        .order('plate_number');
      if (vehiclesError) throw vehiclesError;

      const { data: assignmentsData, error: assignError } = await supabase
        .from('vehicle_assign')
        .select(`
          *,
          booking:booking_id (event_datetime, booking_status)
        `)
        .order('dispatch_datetime', { ascending: false });
      if (assignError) throw assignError;
      setAssignments(assignmentsData || []);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const enrichedVehicles = vehiclesData.map(vehicle => {
        // Only consider active assignments (not completed, cancelled, or rejected)
        const activeAssigns = assignmentsData.filter(a => {
          if (a.vehicle_id !== vehicle.vehicle_id) return false;
          if (!a.booking) return false;
          // Exclude completed, cancelled, rejected bookings/assignments
          if (a.assignment_status === 'Completed') return false;
          if (a.booking.booking_status === 'Rejected' || a.booking.booking_status === 'Cancelled') return false;
          return true;
        });

        const todayAssign = activeAssigns.find(a => {
          if (!a.booking?.event_datetime) return false;
          const eventDate = new Date(a.booking.event_datetime);
          eventDate.setHours(0, 0, 0, 0);
          return eventDate.getTime() === today.getTime();
        });

        const futureAssign = activeAssigns.find(a => {
          if (!a.booking?.event_datetime) return false;
          const eventDate = new Date(a.booking.event_datetime);
          eventDate.setHours(0, 0, 0, 0);
          return eventDate.getTime() > today.getTime();
        });

        let displayStatus = vehicle.vehicle_status;
        let statusNote = '';

        if (vehicle.vehicle_status === 'Maintenance') {
          displayStatus = 'Maintenance';
          statusNote = 'Under maintenance';
        } else if (vehicle.vehicle_status === 'Unavailable') {
          displayStatus = 'Unavailable';
          statusNote = 'Not available for dispatch';
        } else if (vehicle.vehicle_status === 'Available') {
          if (todayAssign) {
            displayStatus = 'Deployed Today';
            const eventDate = todayAssign.booking?.event_datetime ? new Date(todayAssign.booking.event_datetime) : null;
            statusNote = eventDate ? `Event: ${eventDate.toLocaleString()}` : '';
          } else if (futureAssign) {
            displayStatus = 'Upcoming';
            const eventDate = futureAssign.booking?.event_datetime ? new Date(futureAssign.booking.event_datetime) : null;
            statusNote = eventDate ? `Scheduled: ${eventDate.toLocaleString()}` : '';
          } else {
            displayStatus = 'Available';
          }
        }

        return {
          ...vehicle,
          displayStatus,
          statusNote,
          activeAssigns: activeAssigns,
          totalAssigns: activeAssigns.length,
        };
      });

      setVehicles(enrichedVehicles);
    } catch (error) {
      handleError(error, 'Unable to load vehicles. Please refresh.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBookings = async () => {
    try {
      const { data, error } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_type,
          booking_status,
          event_datetime,
          venue,
          pax_count,
          notes,
          customer:customer_id (first_name, last_name, contact_no, cus_address)
        `)
        .eq('booking_status', 'Approved')
        .order('event_datetime', { ascending: false });
      if (!error) setBookings(data || []);
    } catch (error) {
      console.error('Error fetching bookings for assignment:', error);
    }
  };

  useEffect(() => {
    fetchVehicles();
    fetchBookings();
  }, []);

  // --- HANDLERS ---
  const handleNewVehicleChange = (e) => {
    const { name, value } = e.target;
    setNewVehicleForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditVehicleChange = (e) => {
    const { name, value } = e.target;
    setEditVehicleForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAssignChange = (e) => {
    const { name, value } = e.target;
    setAssignForm((prev) => ({ ...prev, [name]: value }));
  };

  // --- When booking is selected, auto-suggest dispatch time ---
  const handleBookingSelect = (e) => {
    const bookingId = e.target.value;
    setAssignForm(prev => ({ ...prev, booking_id: bookingId }));

    if (bookingId) {
      const selectedBooking = bookings.find(b => b.booking_id === bookingId);
      if (selectedBooking && selectedBooking.event_datetime) {
        const eventDate = new Date(selectedBooking.event_datetime);
        const dispatchDate = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
        if (dispatchDate < new Date()) {
          dispatchDate.setTime(Date.now());
        }
        const formatted = dispatchDate.toISOString().slice(0, 16);
        setAssignForm(prev => ({ ...prev, dispatch_datetime: formatted }));
      }
    } else {
      setAssignForm(prev => ({ ...prev, dispatch_datetime: '' }));
    }
    setSelectedVehicleIds([]);
  };

  // --- Toggle vehicle selection ---
  const toggleVehicleSelection = (vehicleId) => {
    setSelectedVehicleIds(prev =>
      prev.includes(vehicleId)
        ? prev.filter(id => id !== vehicleId)
        : [...prev, vehicleId]
    );
  };

  // --- Get selected booking details ---
  const selectedBooking = bookings.find(b => b.booking_id === assignForm.booking_id);

  // --- ADD VEHICLE ---
  const handleAddVehicle = async (e) => {
    e.preventDefault();
    if (!newVehicleForm.plate_number) {
      toast.error('Plate number is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .insert([{
          plate_number: newVehicleForm.plate_number,
          vehicle_type: newVehicleForm.vehicle_type,
          vehicle_status: 'Available',
        }]);

      if (error) throw error;

      setNewVehicleForm({ plate_number: '', vehicle_type: 'Car', vehicle_status: 'Available' });
      toast.success('Vehicle added successfully!');
      await fetchVehicles();
    } catch (error) {
      handleError(error, 'Failed to add vehicle.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT VEHICLE ---
  const handleEditClick = (vehicle) => {
    setEditVehicleForm({
      vehicle_id: vehicle.vehicle_id,
      plate_number: vehicle.plate_number,
      vehicle_type: vehicle.vehicle_type,
      vehicle_status: vehicle.vehicle_status,
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editVehicleForm.plate_number) {
      toast.error('Plate number is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .update({
          plate_number: editVehicleForm.plate_number,
          vehicle_type: editVehicleForm.vehicle_type,
          vehicle_status: editVehicleForm.vehicle_status,
        })
        .eq('vehicle_id', editVehicleForm.vehicle_id);

      if (error) throw error;

      setIsEditModalOpen(false);
      toast.success('Vehicle updated successfully!');
      await fetchVehicles();
    } catch (error) {
      handleError(error, 'Failed to update vehicle.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- DELETE VEHICLE (with cleanup) ---
  const handleDeleteVehicle = async (vehicleId) => {
    const confirmed = await showConfirm({
      title: 'Delete Vehicle?',
      message: 'This will delete the vehicle and all its assignments. Are you sure?',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      // Delete all assignments for this vehicle
      const { error: deleteAssignError } = await supabase
        .from('vehicle_assign')
        .delete()
        .eq('vehicle_id', vehicleId);
      if (deleteAssignError) throw deleteAssignError;

      const { error } = await supabase
        .from('vehicle')
        .delete()
        .eq('vehicle_id', vehicleId);
      if (error) throw error;

      toast.success('Vehicle removed successfully.');
      await fetchVehicles();
    } catch (error) {
      handleError(error, 'Failed to delete vehicle.');
    }
  };

  // --- RETURN VEHICLE (mark assignment as Completed) ---
  const handleReturnVehicle = async (assignmentId) => {
    const confirmed = await showConfirm({
      title: 'Return Vehicle?',
      message: 'Mark this assignment as completed. The vehicle will be available for future events.',
      confirmLabel: 'Return',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('vehicle_assign')
        .update({ assignment_status: 'Completed' })
        .eq('assignment_id', assignmentId);

      if (error) throw error;

      toast.success('Vehicle returned successfully.');
      await fetchVehicles();
    } catch (error) {
      handleError(error, 'Failed to return vehicle.');
    }
  };

  // --- ASSIGN VEHICLES (Multiple) ---
  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one vehicle.');
      return;
    }
    if (!assignForm.booking_id) {
      toast.error('Please select a booking.');
      return;
    }

    setIsSubmitting(true);

    try {
      const selectedBooking = bookings.find(b => b.booking_id === assignForm.booking_id);
      if (!selectedBooking) {
        toast.error('Selected booking not found.');
        setIsSubmitting(false);
        return;
      }

      const eventDate = selectedBooking.event_datetime ? new Date(selectedBooking.event_datetime) : null;
      if (!eventDate) {
        toast.error('Booking has no event date.');
        setIsSubmitting(false);
        return;
      }

      // Check conflicts for all selected vehicles (same date, active assignments)
      const conflicts = [];
      for (const vehicleId of selectedVehicleIds) {
        const existingAssign = assignments.find(a => {
          if (a.vehicle_id !== vehicleId) return false;
          if (!a.booking?.event_datetime) return false;
          if (a.assignment_status === 'Completed') return false;
          if (a.booking.booking_status === 'Rejected' || a.booking.booking_status === 'Cancelled') return false;
          const assignEventDate = new Date(a.booking.event_datetime);
          return assignEventDate.toDateString() === eventDate.toDateString();
        });
        if (existingAssign) {
          const vehicle = vehicles.find(v => v.vehicle_id === vehicleId);
          conflicts.push(`${vehicle?.plate_number || vehicleId}`);
        }
      }

      if (conflicts.length > 0) {
        toast.error(`Cannot assign: Vehicle(s) ${conflicts.join(', ')} already assigned to another event on ${eventDate.toLocaleDateString()}.`);
        setIsSubmitting(false);
        return;
      }

      // Insert all assignments
      const inserts = selectedVehicleIds.map(vehicleId => ({
        vehicle_id: vehicleId,
        booking_id: assignForm.booking_id,
        dispatch_datetime: assignForm.dispatch_datetime,
        assignment_status: 'Scheduled',
      }));

      const { error: assignError } = await supabase
        .from('vehicle_assign')
        .insert(inserts);

      if (assignError) throw assignError;

      setIsAssignModalOpen(false);
      setAssignForm({ booking_id: '', dispatch_datetime: '', assignment_status: 'Scheduled' });
      setSelectedVehicleIds([]);
      toast.success(`Successfully assigned ${inserts.length} vehicle(s).`);
      await fetchVehicles();
    } catch (error) {
      handleError(error, 'Failed to assign vehicles.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- CALCULATED STATS ---
  const totalCars = vehicles.filter((v) => v.vehicle_type === 'Car').length;
  const totalMotorcycles = vehicles.filter((v) => v.vehicle_type === 'Motorcycle').length;
  const availableCount = vehicles.filter((v) => v.displayStatus === 'Available').length;
  const deployedTodayCount = vehicles.filter((v) => v.displayStatus === 'Deployed Today').length;
  const upcomingCount = vehicles.filter((v) => v.displayStatus === 'Upcoming').length;
  const activeAssignmentsCount = assignments.filter(a => a.assignment_status !== 'Completed' && a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled').length;

  // --- RENDER ---
  return (
    <div className="space-y-6 relative pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vehicles</h1>
          <p className="text-sm text-slate-500">Monitor and manage your fleet – assign to multiple events, return when done.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsManageFleetModalOpen(true)}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
          >
            <Settings size={16} /> Manage Fleet
          </button>
          <button
            onClick={() => { setSelectedVehicleIds([]); setIsAssignModalOpen(true); }}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Assign Vehicle
          </button>
          <button
            onClick={() => { fetchVehicles(); fetchBookings(); }}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
            title="Refresh data"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* SUMMARY STAT CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Fleet</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{vehicles.length}</h3>
          <p className="text-xs text-slate-600 mt-2 font-medium">
            {totalCars} cars • {totalMotorcycles} motorcycles
          </p>
        </div>

        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Available Now</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{availableCount}</h3>
        </div>

        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Deployed Today</p>
          <h3 className="text-3xl font-extrabold text-[#008A45]">{deployedTodayCount}</h3>
        </div>

        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-600 mb-1">Active Assignments</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{activeAssignmentsCount}</h3>
        </div>
      </div>

      {/* VEHICLE TABLE */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>Fleet Inventory</span>
          <span className="text-xs font-normal text-slate-500">Status is based on active assignments (completed assignments are ignored)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Plate Number</th>
                <th className="p-4 font-bold">Type</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Details</th>
                <th className="p-4 font-bold text-center">Assignments</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan="6" className="p-6 text-center text-slate-400">Loading fleet...</td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-6 text-center text-slate-400 italic">
                    No vehicles in fleet.
                  </td>
                </tr>
              ) : (
                vehicles.map((vehicle) => (
                  <tr key={vehicle.vehicle_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-bold text-slate-900">{vehicle.plate_number}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#CBDEDD]/60 border border-[#a3c7c4] text-slate-800">
                        {vehicle.vehicle_type === 'Car' ? <Car size={14} /> : <Truck size={14} />}
                        {vehicle.vehicle_type}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold 
                        ${vehicle.displayStatus === 'Available' ? 'bg-green-50 border border-green-200 text-green-700' :
                          vehicle.displayStatus === 'Deployed Today' ? 'bg-yellow-50 border border-yellow-200 text-yellow-700' :
                          vehicle.displayStatus === 'Upcoming' ? 'bg-blue-50 border border-blue-200 text-blue-700' :
                          vehicle.displayStatus === 'Maintenance' ? 'bg-orange-50 border border-orange-200 text-orange-700' :
                          'bg-slate-100 border border-slate-300 text-slate-600'}`}
                      >
                        {vehicle.displayStatus === 'Available' ? '✅' :
                         vehicle.displayStatus === 'Deployed Today' ? '🚗' :
                         vehicle.displayStatus === 'Upcoming' ? '📅' :
                         vehicle.displayStatus === 'Maintenance' ? '🔧' : '❌'}
                        {vehicle.displayStatus}
                      </span>
                    </td>
                    <td className="p-4 text-slate-600 text-xs">
                      {vehicle.statusNote || '–'}
                    </td>
                    <td className="p-4 text-center font-semibold">
                      {vehicle.totalAssigns || 0}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleEditClick(vehicle)}
                          className="text-slate-400 hover:text-[#008A45] transition-colors cursor-pointer"
                          title="Edit vehicle"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteVehicle(vehicle.vehicle_id)}
                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                          title="Delete vehicle (all assignments removed)"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ACTIVE ASSIGNMENTS TABLE – like Equipment's active assignments */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>Active Vehicle Assignments</span>
          <span className="text-xs font-normal text-slate-500">{activeAssignmentsCount} active</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Vehicle</th>
                <th className="p-4 font-bold">Booking</th>
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Event Date</th>
                <th className="p-4 font-bold">Dispatch</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400">Loading assignments...</td></tr>
              ) : assignments.filter(a => a.assignment_status !== 'Completed' && a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled').length === 0 ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400 italic">No active assignments.</td></tr>
              ) : (
                assignments
                  .filter(a => a.assignment_status !== 'Completed' && a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled')
                  .map((assign) => {
                    const vehicle = vehicles.find(v => v.vehicle_id === assign.vehicle_id);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const eventDate = assign.booking?.event_datetime ? new Date(assign.booking.event_datetime) : null;
                    const isToday = eventDate && eventDate.toDateString() === today.toDateString();
                    return (
                      <tr key={assign.assignment_id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-bold text-slate-900">{vehicle?.plate_number || 'Unknown'}</td>
                        <td className="p-4 text-slate-600">{assign.booking_id?.slice(0, 8) || 'N/A'}</td>
                        <td className="p-4">
                          {assign.booking?.customer?.first_name} {assign.booking?.customer?.last_name}
                        </td>
                        <td className="p-4">
                          {eventDate ? eventDate.toLocaleString() : 'N/A'}
                          {isToday && <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded-full">Today</span>}
                        </td>
                        <td className="p-4">
                          {assign.dispatch_datetime ? new Date(assign.dispatch_datetime).toLocaleString() : 'N/A'}
                        </td>
                        <td className="p-4 text-center">
                          <span className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-xs font-medium">
                            {assign.assignment_status || 'Scheduled'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleReturnVehicle(assign.assignment_id)}
                            className="text-blue-500 hover:text-blue-700 transition-colors cursor-pointer flex items-center gap-1 text-sm font-medium"
                          >
                            <Undo2 size={16} /> Return
                          </button>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 1. MANAGE FLEET MODAL (Add Vehicle) */}
      {/* ========================================================= */}
      {isManageFleetModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add New Vehicle</h2>
                <p className="text-xs text-slate-500">Add a vehicle to your fleet</p>
              </div>
              <button
                onClick={() => setIsManageFleetModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddVehicle} className="p-6 space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input
                  type="text"
                  name="plate_number"
                  placeholder="e.g. ABC 1234"
                  value={newVehicleForm.plate_number}
                  onChange={handleNewVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type</label>
                <select
                  name="vehicle_type"
                  value={newVehicleForm.vehicle_type}
                  onChange={handleNewVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Car">Car</option>
                  <option value="Motorcycle">Motorcycle</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsManageFleetModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* 2. EDIT VEHICLE MODAL */}
      {/* ========================================================= */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Edit Vehicle</h2>
                <p className="text-xs text-slate-500">Update vehicle details</p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input
                  type="text"
                  name="plate_number"
                  placeholder="e.g. ABC 1234"
                  value={editVehicleForm.plate_number}
                  onChange={handleEditVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type</label>
                <select
                  name="vehicle_type"
                  value={editVehicleForm.vehicle_type}
                  onChange={handleEditVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Car">Car</option>
                  <option value="Motorcycle">Motorcycle</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Base Status</label>
                <select
                  name="vehicle_status"
                  value={editVehicleForm.vehicle_status}
                  onChange={handleEditVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Available">Available</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Unavailable">Unavailable</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">Base status overrides auto-status when set to Maintenance or Unavailable.</p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* 3. ASSIGN VEHICLE MODAL - Multiple Vehicle Selection */}
      {/* ========================================================= */}
      {isAssignModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Assign Vehicles</h2>
                <p className="text-xs text-slate-500">Deploy multiple vehicles to an event</p>
              </div>
              <button
                onClick={() => { setIsAssignModalOpen(false); setSelectedVehicleIds([]); }}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              {/* Booking Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Booking</label>
                <select
                  name="booking_id"
                  value={assignForm.booking_id}
                  onChange={handleBookingSelect}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                >
                  <option value="">-- Choose a booking --</option>
                  {bookings.map((b) => {
                    const name = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                    const date = b.event_datetime ? new Date(b.event_datetime).toLocaleDateString() : '';
                    return (
                      <option key={b.booking_id} value={b.booking_id}>
                        {b.booking_id.slice(0, 8)} – {name} ({date})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Booking Details Preview */}
              {selectedBooking && (
                <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-slate-900 text-sm">Booking Details</h4>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                      {selectedBooking.booking_status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 col-span-2">
                      <Users size={14} className="text-slate-400" />
                      <span className="text-slate-600">Customer:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedBooking.customer ? `${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}` : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <Calendar size={14} className="text-slate-400" />
                      <span className="text-slate-600">Event Date:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedBooking.event_datetime ? new Date(selectedBooking.event_datetime).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <MapPin size={14} className="text-slate-400" />
                      <span className="text-slate-600">Venue:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.venue || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-slate-400" />
                      <span className="text-slate-600">Pax:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.pax_count || 0}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">Type:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.booking_type || 'Package'}</span>
                    </div>
                    {selectedBooking.notes && (
                      <div className="col-span-2 text-xs text-slate-500 border-t border-slate-200 pt-2 mt-1">
                        <span className="font-medium text-slate-600">Notes:</span> {selectedBooking.notes}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Vehicle Selection (Checkboxes) – show only vehicles not already assigned to this date */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Vehicles</label>
                <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto p-2 bg-slate-50">
                  {vehicles.filter(v => v.vehicle_status === 'Available').length === 0 ? (
                    <p className="text-sm text-slate-500 italic p-2">No available vehicles.</p>
                  ) : (
                    vehicles.filter(v => v.vehicle_status === 'Available').map((v) => {
                      // Check if this vehicle is already assigned to the selected booking's date
                      const eventDate = selectedBooking?.event_datetime ? new Date(selectedBooking.event_datetime) : null;
                      const alreadyAssigned = eventDate && assignments.some(a => {
                        if (a.vehicle_id !== v.vehicle_id) return false;
                        if (a.assignment_status === 'Completed') return false;
                        if (a.booking?.booking_status === 'Rejected' || a.booking?.booking_status === 'Cancelled') return false;
                        const aDate = a.booking?.event_datetime ? new Date(a.booking.event_datetime) : null;
                        return aDate && aDate.toDateString() === eventDate.toDateString();
                      });
                      return (
                        <label key={v.vehicle_id} className={`flex items-center gap-2 p-2 hover:bg-slate-100 rounded cursor-pointer ${alreadyAssigned ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedVehicleIds.includes(v.vehicle_id)}
                            onChange={() => toggleVehicleSelection(v.vehicle_id)}
                            disabled={alreadyAssigned}
                            className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]"
                          />
                          <span className="text-sm font-medium text-slate-700">{v.plate_number}</span>
                          <span className="text-xs text-slate-500">({v.vehicle_type}) – {v.displayStatus}</span>
                          {alreadyAssigned && <span className="text-xs text-red-500 ml-2">(already assigned to this date)</span>}
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Selected: <span className="font-bold">{selectedVehicleIds.length}</span> vehicle{selectedVehicleIds.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Dispatch Date/Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Dispatch Date/Time (for all selected vehicles)</label>
                <input
                  type="datetime-local"
                  name="dispatch_datetime"
                  value={assignForm.dispatch_datetime}
                  onChange={handleAssignChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
                {selectedBooking && selectedBooking.event_datetime && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <Clock size={12} className="text-slate-400" />
                    <span>Event starts at: <span className="font-semibold text-slate-700">{new Date(selectedBooking.event_datetime).toLocaleString()}</span></span>
                    <span className="mx-1">•</span>
                    <span className="text-[#008A45] font-medium">Auto-suggested: 2 hours before event</span>
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1">All selected vehicles will have the same dispatch time.</p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setIsAssignModalOpen(false); setSelectedVehicleIds([]); }}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Assigning...' : `Assign ${selectedVehicleIds.length} Vehicle${selectedVehicleIds.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}